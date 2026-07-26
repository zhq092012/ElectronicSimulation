import sqlite3InitModule from "@sqlite.org/sqlite-wasm";
import * as satellite from "satellite.js";
import ddlSchema from "../db/schema.sql?raw";
import type {
  Asset,
  Weapon,
  CommunicationWindow,
  Scenario,
  PassMatrixItem,
  VisibleMatrixItem,
  OverheadMatrixItem,
  OverheadMatrixTick,
  OverheadMatrixSegment,
  AttackMatrixItem,
  TacticalMatrices,
  LinkStatus,
  EarliestFullChainAnalysis,
  FullChainAttribution,
  WeaponCategory,
  KillType,
} from "../types/electronic";

/**
 * 数据库执行选项
 */
interface Sqlite3ExecOptions {
  sql: string; // SQL语句
  bind?: unknown[]; // 绑定参数
  rowMode?: "object"; // 返回行模式
  callback?: (row: any) => void; // 回调函数
}
/**
 * 数据库对象
 */
interface Sqlite3Database {
  filename: string; // 数据库文件名
  exec: (options: string | Sqlite3ExecOptions) => void; // 执行SQL语句
  changes: () => number; // 获取影响行数
}

/**
 * 数据库库
 */
interface Sqlite3Library {
  version: {
    libVersion: string; // 数据库版本
  };
  oo1: {
    OpfsDb: new (filename: string, flags: string) => Sqlite3Database;
  };
}

/**
 * 扩展了计算权重的 Asset 类型
 */
interface CalculatedAsset extends Asset {
  calculated_priority?: number;
}

/**
 * 包含双行轨道数据(TLE)且非空的卫星信息
 */
interface SatTleInfo {
  id: string;
  tle_data: string;
}

/**
 * 包含有效位置信息的地面/低空基底资产
 */
interface StationInfo {
  id: string;
  lat: number;//纬度
  lng: number;//经度
  alt: number | null;//高度
  terrain_mask_angle: number;//地形遮挡角
}

/**
 * 场景时间配置
 */
type ScenarioTimeConfig = Pick<
  Scenario,
  "start_time" | "end_time" | "time_step_seconds" //场景开始时间|场景结束时间|场景时间步长（秒）
>;

/**
 * 工作线程请求
 * 'INIT': 初始化数据库
 * 'CALCULATE_WINDOWS': 计算通信窗口
 * 'UPDATE_SATELLITE_POSITIONS': 更新卫星位置
 * 'AUTO_ALLOCATE_WEAPONS': 自动分配武器
 * 'QUERY': 查询
 * 'EXEC': 执行
 */
interface WorkerRequest {
  type:
  | "INIT"
  | "CALCULATE_WINDOWS"
  | "UPDATE_SATELLITE_POSITIONS"
  | "AUTO_ALLOCATE_WEAPONS"
  | "GENERATE_MATRICES"
  | "QUERY"
  | "EXEC";
  id?: string; // 请求ID
  sql?: string; // SQL语句
  params?: any; // 绑定参数
}

/**
 * 数据库
 */
let db: Sqlite3Database | null = null;

/**
 * 初始化 SQLite Wasm 与 OPFS 数据库
 */
async function initDb() {
  try {
    // 新版 @sqlite.org/sqlite-wasm 的 init() 不接受参数，wasm 路径由构建工具统一处理
    const sqlite3 = (await sqlite3InitModule()) as unknown as Sqlite3Library;

    console.log("SQLite Wasm version:", sqlite3.version.libVersion);

    // 打开 OPFS 数据库 (如果不存在则自动创建)
    db = new sqlite3.oo1.OpfsDb("/cema_wargame_v3.db", "c");
    console.log("SQLite OPFS Database opened:", db.filename);

    // 逐句执行 schema.sql 初始化数据库表
    const statements = ddlSchema
      .split(";")
      .map((s) => s.trim())
      .filter((s) => s.length > 0);

    // 开启事务以加速建表过程
    db.exec("BEGIN TRANSACTION;");
    try {
      for (const stmt of statements) {
        db.exec(stmt);
      }
      db.exec("COMMIT;");
    } catch (e) {
      try {
        db.exec("ROLLBACK;");
      } catch (err) { }
      throw e;
    }

    console.log("Database tables successfully initialized.");
    postMessage({ type: "INIT_SUCCESS" });
  } catch (error) {
    console.error("SQLite Worker Init Error:", error);
    const errorMessage = error instanceof Error ? error.message : String(error);
    postMessage({ type: "INIT_ERROR", error: errorMessage });
  }
}

/**
 * 球面半正矢公式 (Haversine Formula)
 * @param lat1 纬度1
 * @param lng1 经度1
 * @param lat2 纬度2
 * @param lng2 经度2
 * @returns 经纬度空间球面距离 (km)
 */
function calculateDistance(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number,
): number {
  if (lat1 === 0 && lng1 === 0) return -1; // 网络武器无物理距离限制
  const R = 6371; // 地球半径 (km)
  const dLat = ((lat2 - lat1) * Math.PI) / 180;//纬度差（弧度）
  const dLng = ((lng2 - lng1) * Math.PI) / 180;//经度差（弧度）

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
    Math.cos((lat2 * Math.PI) / 180) *
    Math.sin(dLng / 2) *
    Math.sin(dLng / 2);//中心角（弧度）
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));//中心角
  return R * c;//球面距离（km）
}

/**
 * 核心推运对抗战术引擎 (Event Loop 打击判定与背包分配)
 * @param intensity 推演烈度
 * @param currentTime 当前时间戳
 * @param scenarioId 场景ID
 * @param scenarioEndTime 场景结束时间戳 (Unix)，用于计算 HARD kill 的剩余破坏时长
 */
function autoAllocateWeapons(
  intensity: string,
  currentTime: number,
  scenarioId: string,
  scenarioEndTime: number,
) {
  if (!db) {
    throw new Error("Database is not initialized.");
  }

  // 每一分钟的决策开始前，将上一分钟电磁软干扰（JAMMED）状态自动复位为正常通信。
  // 只有导弹物理拦截（DESTROYED）是永久不可逆的。
  db.exec({
    sql: `UPDATE communication_windows SET link_status = 'TRANSMITTING' WHERE scenario_id = ? AND link_status = 'JAMMED'`,
    bind: [scenarioId],
  });

  // 1. 获取蓝方已被红方电子侦察发现的资产
  const assets: CalculatedAsset[] = [];
  db.exec({
    sql: `SELECT * FROM assets WHERE side = 'BLUE' AND is_detected_by_red = 1 AND anti_jam_level > 0`,
    rowMode: "object",
    callback: (row: any) => {
      assets.push(row as CalculatedAsset);
    },
  });

  if (assets.length === 0) {
    return { engagements_created: 0 };
  }

  // 动态解算价值权重优先级
  assets.forEach((asset) => {
    let score = asset.base_priority || 50;//基础目标价值分 (0-100, 默认 50)
    if (asset.usage_type === "MILITARY") score += 30;//军事目标价值更高
    if (asset.func_type === "COMM" || asset.func_type === "RELAY") score += 20;//通信或中继目标价值更高  'RECON' (侦察), 'COMM' (通信), 'RELAY' (中继), 'OTHER' (其他)
    if (asset.layer === 2) score += 15; // 卫星价值更高
    asset.calculated_priority = score;
  });

  // 按价值权重从高到低排序 (背包算法前置条件)
  assets.sort(
    (a, b) => (b.calculated_priority || 0) - (a.calculated_priority || 0),
  );

  // 2. 获取红方武器库
  const weapons: Weapon[] = [];
  db.exec({
    sql: `SELECT * FROM weapons`,
    rowMode: "object",
    callback: (row: any) => {
      weapons.push(row as Weapon);
    },
  });
  // 根据当前推演烈度过滤红方可用武器
  // category:跨域杀伤机理分类 w.category:跨域杀伤机理分类,'EW':'电子战','CYBER':'网络战','KINETIC':'物理战','DEW':'定向能武器'
  // kill_type:杀伤机理 SOFT:'软杀伤'，'HARD':'硬杀伤' 
  const allowedWeapons = weapons.filter((w) => {
    if (intensity === "LOW") {
      return (
        (w.category === "EW" || w.category === "CYBER") &&
        w.kill_type === "SOFT"
      );
    } else if (intensity === "MEDIUM") {
      return (
        w.category === "EW" || w.category === "CYBER" || w.category === "DEW"
      );
    }
    return true; // HIGH 烈度全开 (包括动能导弹)
  });

  // 3. 获取当前分钟 (Tick) 正在正常通信的活跃链路窗口
  const activeWindows: CommunicationWindow[] = [];
  db.exec({
    sql: `SELECT * FROM communication_windows WHERE scenario_id = ? AND ? BETWEEN window_start AND window_end AND link_status != 'DESTROYED'`,
    bind: [scenarioId, currentTime],
    rowMode: "object",
    callback: (row: any) => {
      activeWindows.push(row as CommunicationWindow);
    },
  });

  if (activeWindows.length === 0) {
    return { engagements_created: 0 };
  }

  db.exec("BEGIN TRANSACTION;");
  try {
    // Delete any existing engagements at this tick to avoid UNIQUE constraint violation on replay/slider drag
    db.exec({
      sql: `DELETE FROM engagements WHERE action_time = ?`,
      bind: [currentTime],
    });

    let engagementsCount = 0;

    for (const asset of assets) {
      // 找出与该资产相连的所有活动链路
      const connectedLinks = activeWindows.filter(
        (link) => link.source_id === asset.id || link.target_id === asset.id,
      );

      if (connectedLinks.length === 0) continue;

      // 贪心匹配最适用的打击武器（动态对武器进行战术适应性排序）
      let selectedWeapon: Weapon | null = null;
      let computedDistance = 0;

      const candidateWeapons = [...allowedWeapons].sort((w1, w2) => {
        // 1. 高烈度下，如果是天基卫星资产 (layer === 2)，优先分配 HQ-19 (KINETIC) 动能打击以实现物理摧毁
        if (intensity === "HIGH" && asset.layer === 2) {
          if (w1.category === "KINETIC" && w2.category !== "KINETIC") return -1;
          if (w2.category === "KINETIC" && w1.category !== "KINETIC") return 1;
        }

        const assetLat = asset.lat !== null ? asset.lat : 24.5;
        const assetLng = asset.lng !== null ? asset.lng : 121.5;
        const d1 =
          w1.category === "CYBER"
            ? -1
            : calculateDistance(w1.base_lat, w1.base_lng, assetLat, assetLng);
        const d2 =
          w2.category === "CYBER"
            ? -1
            : calculateDistance(w2.base_lat, w2.base_lng, assetLat, assetLng);

        // 2. 优先在射程内分配电磁脉冲武器 (DEW/EMP, range=200)
        const w1_is_emp_in_range =
          w1.category === "DEW" &&
          (w1.max_range === -1 || (d1 > 0 && d1 <= w1.max_range));
        const w2_is_emp_in_range =
          w2.category === "DEW" &&
          (w2.max_range === -1 || (d2 > 0 && d2 <= w2.max_range));
        if (w1_is_emp_in_range && !w2_is_emp_in_range) return -1;
        if (w2_is_emp_in_range && !w1_is_emp_in_range) return 1;

        // 3. 其次在射程内分配车载干扰器 (EW, range=380)
        const w1_is_jammer_in_range =
          w1.category === "EW" &&
          (w1.max_range === -1 || (d1 > 0 && d1 <= w1.max_range));
        const w2_is_jammer_in_range =
          w2.category === "EW" &&
          (w2.max_range === -1 || (d2 > 0 && d2 <= w2.max_range));
        if (w1_is_jammer_in_range && !w2_is_jammer_in_range) return -1;
        if (w2_is_jammer_in_range && !w1_is_jammer_in_range) return 1;

        // 4. 最终将网络协议劫持 (CYBER) 作为全局保底手段
        if (w1.category === "CYBER" && w2.category !== "CYBER") return 1;
        if (w2.category === "CYBER" && w1.category !== "CYBER") return -1;

        return 0;
      });

      for (const weapon of candidateWeapons) {
        if (weapon.inventory === 0) continue; // 弹药已耗尽

        let dist = -1;
        if (weapon.category !== "CYBER") {
          const assetLat = asset.lat !== null ? asset.lat : 24.5;
          const assetLng = asset.lng !== null ? asset.lng : 121.5;
          dist = calculateDistance(
            weapon.base_lat,
            weapon.base_lng,
            assetLat,
            assetLng,
          );

          // 射程约束
          if (weapon.max_range !== -1 && dist > weapon.max_range) {
            continue;
          }
        }

        selectedWeapon = weapon;
        computedDistance = dist;
        break; // 贪心背包分配
      }

      if (selectedWeapon) {
        // 消耗武器库存
        if (selectedWeapon.inventory > 0) {
          selectedWeapon.inventory -= 1;
          db.exec({
            sql: `UPDATE weapons SET inventory = ? WHERE id = ?`,
            bind: [selectedWeapon.inventory, selectedWeapon.id],
          });
        }

        // 解算 CEMA 多域战物理衰减因子
        // 1. 距离反比损耗
        const d = computedDistance > 0 ? computedDistance : 50.0;
        const attenuation_dist = 1 / (4 * Math.PI * Math.pow(d, 2));

        // 2. 自由空间高程损耗
        const alt = asset.alt || 0.1;
        const attenuation_alt = 1 / (1 + Math.pow(alt / 100, 2));

        // 3. 地形遮蔽损耗
        const attenuation_terrain = asset.layer === 0 ? 0.75 : 1.0;

        // 4. 多普勒频移损耗
        const attenuation_vel = asset.layer === 2 ? 0.85 : 1.0;

        // 5. 天线偏角折损
        const attenuation_att = 0.9;

        // 解算最终有效干信比 (J/S Ratio)
        // 假定干扰开机基准功率为 3000W，蓝方通信基准功率为 0.05W，并考虑通信链路基准距离的自由空间损耗以计算接收端功率
        const P_jam = 3000;
        const d_sig = 600.0;
        const P_sig_recv = 0.05 / (4 * Math.PI * Math.pow(d_sig, 2));
        const js =
          10 *
          Math.log10(
            (P_jam *
              attenuation_dist *
              attenuation_terrain *
              attenuation_alt *
              attenuation_vel *
              attenuation_att) /
            P_sig_recv,
          );
        const final_js = Math.round(js * 100) / 100;

        // 打击判定: 软杀伤需干信比超过接收机抗干扰等级；硬杀伤（动能导弹）为物理毁伤，直接按导弹命中概率判定
        const threshold = asset.anti_jam_level || 50;

        let successProbability = 1.0;
        if (selectedWeapon.category === "CYBER")
          successProbability = 0.5; // 网络协议漏洞利用，成功率较低
        else if (selectedWeapon.category === "EW")
          successProbability = 0.65; // 电磁波干扰易受方向和极化衰减，成功率一般
        else if (selectedWeapon.category === "DEW")
          successProbability = 0.8; // EMP 强电磁脉冲压制成功率较高
        else if (selectedWeapon.category === "KINETIC")
          successProbability = 0.95; // 动能防空导弹物理拦截成功率极高

        const isHardKill =
          selectedWeapon.kill_type === "HARD" ||
          selectedWeapon.category === "KINETIC";
        const isSuccessful =
          (isHardKill || final_js >= threshold) &&
            Math.random() <= successProbability
            ? 1
            : 0;

        const engageId = `engage-${selectedWeapon.id}-${asset.id}-${currentTime}`;
        const targetWindowId = connectedLinks[0].id;

        // 写入交战日志表
        db.exec({
          sql: `
            INSERT INTO engagements (id, plan_id, weapon_id, target_window_id, action_time, attenuation_dist, attenuation_terrain, attenuation_alt, attenuation_vel, attenuation_att, final_js_ratio, is_successful)
            VALUES (?, 'plan-001', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `,
          bind: [
            engageId,
            selectedWeapon.id,
            targetWindowId,
            currentTime,
            attenuation_dist,
            attenuation_terrain,
            attenuation_alt,
            attenuation_vel,
            attenuation_att,
            final_js,
            isSuccessful,
          ],
        });

        engagementsCount += 1;

        // 判定成功：更新链路及资产状态
        if (isSuccessful === 1) {
          const newStatus =
            selectedWeapon.kill_type === "HARD" ? "DESTROYED" : "JAMMED";

          // ① 更新当前时刻受影响链路状态
          db.exec({
            sql: `
              UPDATE communication_windows 
              SET link_status = ? 
              WHERE scenario_id = ? AND ? BETWEEN window_start AND window_end
                AND (source_id = ? OR target_id = ?)
            `,
            bind: [newStatus, scenarioId, currentTime, asset.id, asset.id],
          });

          // ★ 立即捕获受影响链路数（必须在其他 UPDATE 之前，否则 db.changes() 会被覆盖）
          const linksAffected = db.changes();

          if (selectedWeapon.kill_type === "HARD") {
            // ② 硬摧毁：同步摧毁该节点的所有【未来时间窗口】链路
            //    （节点已被物理消灭，其后续通信窗口不可能恢复）
            db.exec({
              sql: `
                UPDATE communication_windows 
                SET link_status = 'DESTROYED' 
                WHERE scenario_id = ? AND window_start > ?
                  AND (source_id = ? OR target_id = ?)
                  AND link_status != 'DESTROYED'
              `,
              bind: [scenarioId, currentTime, asset.id, asset.id],
            });

            // ③ 更新资产本身：抗干扰等级归零，永久退出目标池
            db.exec({
              sql: `UPDATE assets SET anti_jam_level = 0, base_priority = 0 WHERE id = ?`,
              bind: [asset.id],
            });
          }

          // ④ 计算时延贡献
          let delayAdded: number;
          if (selectedWeapon.kill_type === "HARD") {
            // 硬摧毁：节点永久失效，损伤持续到场景结束
            // delay = 当前受影响链路数 × 剩余时间(秒)
            const remainingSeconds = Math.max(0, scenarioEndTime - currentTime);
            delayAdded = Math.max(1, linksAffected) * remainingSeconds;
          } else {
            // 软干扰：可逆压制，每条链路贡献固定短时延 (15s)
            delayAdded = 15 * Math.max(1, linksAffected);
          }
          const destroyedAdded = selectedWeapon.kill_type === "HARD" ? 1 : 0;
          db.exec({
            sql: `
              UPDATE tactical_plans 
              SET total_cost = total_cost + ?,
                  total_delay_achieved = total_delay_achieved + ?,
                  nodes_destroyed = nodes_destroyed + ?
              WHERE id = 'plan-001'
            `,
            bind: [selectedWeapon.action_cost, delayAdded, destroyedAdded],
          });
        }
      }
    }

    db.exec("COMMIT;");
    return { engagements_created: engagementsCount };
  } catch (error) {
    try {
      db.exec("ROLLBACK;");
    } catch (e) {
      console.error("Weapon Allocation Transaction Rollback Failed:", e);
    }
    throw error;
  }
}
/**
 * 解算四大战术算力矩阵 (passMatrix, visibleMatrix, overheadMatrix, attackMatrix)
 */
function generateMatrices(scenarioId: string): TacticalMatrices {
  if (!db) throw new Error('Database is not initialized');
  const activeDb = db;

  // 1. 获取场景时间配置与战区范围
  const scenarios: Scenario[] = [];
  activeDb.exec({
    sql: `SELECT start_time, end_time, time_step_seconds, min_lat, max_lat, min_lng, max_lng FROM scenarios WHERE id = ?`,
    bind: [scenarioId],
    rowMode: 'object',
    callback: (row: any) => { scenarios.push(row as Scenario); }
  });
  if (scenarios.length === 0) throw new Error(`Scenario ${scenarioId} not found`);
  const { start_time, end_time, time_step_seconds, min_lat, max_lat, min_lng, max_lng } = scenarios[0];

  // 2. 解算 passMatrix (空间卫星过境战区时间序列)
  const satAssets: { id: string; tle_data: string }[] = [];
  activeDb.exec({
    sql: `SELECT id, tle_data FROM assets WHERE layer = 2 AND tle_data IS NOT NULL`,
    rowMode: 'object',
    callback: (row: any) => { satAssets.push(row); }
  });

  const passMatrix: PassMatrixItem[] = [];
  satAssets.forEach(sat => {
    try {
      const lines = sat.tle_data.split(/\r?\n|\\n/).map((l: string) => l.trim()).filter((l: string) => l.length > 0);
      if (lines.length >= 2) {
        const satrec = satellite.twoline2satrec(lines[0], lines[1]);
        const windows: { window_start: number; window_end: number }[] = [];
        let inAreaStart: number | null = null;

        let matchCount = 0;
        for (let t = start_time; t <= end_time; t += time_step_seconds) {
          const date = new Date(t * 1000);
          const gmst = satellite.gstime(date);
          const posAndVel = satellite.propagate(satrec, date);
          if (posAndVel && posAndVel.position && typeof posAndVel.position !== 'boolean') {
            const geodetic = satellite.eciToGeodetic(posAndVel.position, gmst);
            const lat = satellite.radiansToDegrees(geodetic.latitude);
            const lng = satellite.radiansToDegrees(geodetic.longitude);

            // 空间卫星过境战场网络大本营与海峡战区广域覆盖视界判定 (广域东亚/西太平洋天基过境视角)
            const isInside = lat >= Math.max(-90, min_lat - 15.0) && lat <= Math.min(90, max_lat + 25.0) &&
                             lng >= Math.max(-180, min_lng - 30.0) && lng <= Math.min(180, max_lng + 25.0);
            if (isInside) {
              if (inAreaStart === null) inAreaStart = t;
            } else {
              if (inAreaStart !== null) {
                if (t > inAreaStart) {
                  windows.push({ window_start: inAreaStart, window_end: t });
                }
                inAreaStart = null;
              }
            }
          }
        }
        if (inAreaStart !== null && end_time > inAreaStart) {
          windows.push({ window_start: inAreaStart, window_end: end_time });
        }

        // 双保险保底：若极短推演时间内空间投影未落在特定经纬框，但卫星已与战区节点建立实际通视，则提取通视时间作为过境感知窗口
        if (windows.length === 0) {
          activeDb.exec({
            sql: `SELECT DISTINCT window_start, window_end FROM communication_windows WHERE source_id = ? OR target_id = ?`,
            bind: [sat.id, sat.id],
            rowMode: 'object',
            callback: (cwRow: any) => {
              windows.push({ window_start: cwRow.window_start, window_end: cwRow.window_end });
            }
          });
        }

        console.log(`[PassMatrix Debug] Sat: ${sat.id}, matchCount: ${matchCount}, windows: ${windows.length}`);
        passMatrix.push({
          sat_id: sat.id,
          sat_name: sat.id,
          windows
        });
      }
    } catch (e) {
      console.error(`Error calculating passMatrix for ${sat.id}:`, e);
    }
  });

  // 3. 解算 visibleMatrix (星地通视时间窗口序列)
  const visibleMatrixMap = new Map<string, VisibleMatrixItem>();
  activeDb.exec({
    sql: `
      SELECT cw.source_id, a1.id as source_name, cw.target_id, a2.id as target_name, cw.window_start, cw.window_end
      FROM communication_windows cw
      JOIN assets a1 ON cw.source_id = a1.id
      JOIN assets a2 ON cw.target_id = a2.id
      WHERE cw.scenario_id = ? AND a1.layer = 2 AND a2.layer IN (0, 1)
      ORDER BY cw.source_id, cw.target_id, cw.window_start
    `,
    bind: [scenarioId],
    rowMode: 'object',
    callback: (row: any) => {
      const key = `${row.source_id}::${row.target_id}`;
      if (!visibleMatrixMap.has(key)) {
        visibleMatrixMap.set(key, {
          source_id: row.source_id,
          source_name: row.source_name,
          target_id: row.target_id,
          target_name: row.target_name,
          windows: []
        });
      }
      const item = visibleMatrixMap.get(key);
      if (item) {
        item.windows.push({
          window_start: row.window_start,
          window_end: row.window_end
        });
      }
    }
  });
  const visibleMatrix = Array.from(visibleMatrixMap.values());

  // 4. 解算 overheadMatrix (全域链路处理与传输时间开销，计算从 start_time 到 end_time 全时间轴每个 Tick 的动态延时)
  const engagementEvents: { action_time: number; is_successful: number; kill_type: string; source_id: string; target_id: string }[] = [];
  activeDb.exec({
    sql: `
      SELECT e.action_time, e.is_successful, w.kill_type, cw.source_id, cw.target_id
      FROM engagements e
      JOIN weapons w ON e.weapon_id = w.id
      JOIN communication_windows cw ON e.target_window_id = cw.id
      WHERE e.is_successful = 1
    `,
    rowMode: 'object',
    callback: (row: any) => { engagementEvents.push(row); }
  });

  const overheadMatrix: OverheadMatrixItem[] = [];
  activeDb.exec({
    sql: `
      SELECT cw.source_id, a1.id as source_name, a1.layer as source_layer,
             cw.target_id, a2.id as target_name, a2.layer as target_layer,
             cw.routing_converge_delay, cw.link_status
      FROM communication_windows cw
      JOIN assets a1 ON cw.source_id = a1.id
      JOIN assets a2 ON cw.target_id = a2.id
      WHERE cw.scenario_id = ? 
        AND ((a1.layer = 2 AND a2.layer = 1) OR (a1.layer = 1 AND a2.layer = 0))
      ORDER BY a1.layer DESC, cw.source_id, cw.target_id
    `,
    bind: [scenarioId],
    rowMode: 'object',
    callback: (row: any) => {
      const transDelay = row.routing_converge_delay || (row.source_layer === 2 ? 20 : 30);
      const procDelay = row.source_layer === 2 ? 10 : 15; // 卫星星载解包或接收站固有的硬件处理开销(秒)

      // 匹配影响此链路节点的真实交战动作
      const relevantEvents = engagementEvents.filter(e =>
        e.source_id === row.source_id || e.target_id === row.source_id ||
        e.source_id === row.target_id || e.target_id === row.target_id
      );

      // 计算从 start_time 到 end_time 范围内每一个 Tick 的延时开销
      const ticks: OverheadMatrixTick[] = [];
      let currentSeg: OverheadMatrixSegment | null = null;
      const segments: OverheadMatrixSegment[] = [];

      for (let t = start_time; t <= end_time; t += time_step_seconds) {
        const tickMin = Math.floor((t - start_time) / 60);

        // 判定该 Tick 时刻是否受交战或状态影响
        const triggeredEvents = relevantEvents.filter(e => e.action_time <= t);
        let tickStatus = 'TRANSMITTING';
        let tickExtraDelay = 0;

        if (triggeredEvents.length > 0) {
          const hasHard = triggeredEvents.some(e => e.kill_type === 'HARD');
          if (hasHard) {
            tickStatus = 'DESTROYED';
            tickExtraDelay = 300;
          } else {
            tickStatus = 'JAMMED';
            tickExtraDelay = 45;
          }
        } else if (row.link_status === 'JAMMED') {
          tickStatus = 'JAMMED';
          tickExtraDelay = 45;
        } else if (row.link_status === 'DESTROYED') {
          tickStatus = 'DESTROYED';
          tickExtraDelay = 300;
        }

        const totalOverhead = transDelay + procDelay + tickExtraDelay;

        ticks.push({
          time: t,
          tick_min: tickMin,
          status: tickStatus,
          trans_delay: transDelay,
          proc_delay: procDelay,
          extra_delay: tickExtraDelay,
          total_overhead: totalOverhead
        });

        // 压缩连续相同延时的时序区间段
        if (!currentSeg || currentSeg.status !== tickStatus || currentSeg.total_overhead !== totalOverhead) {
          if (currentSeg) {
            currentSeg.end_min = tickMin;
            segments.push(currentSeg);
          }
          currentSeg = {
            start_min: tickMin,
            end_min: tickMin,
            status: tickStatus,
            trans_delay: transDelay,
            proc_delay: procDelay,
            extra_delay: tickExtraDelay,
            total_overhead: totalOverhead
          };
        } else {
          currentSeg.end_min = tickMin;
        }
      }
      if (currentSeg) {
        segments.push(currentSeg);
      }

      const totalSum = ticks.reduce((acc, curr) => acc + curr.total_overhead, 0);
      const avgOverhead = Math.round(totalSum / ticks.length);
      const maxOverhead = Math.max(...ticks.map(t => t.total_overhead));
      const minOverhead = Math.min(...ticks.map(t => t.total_overhead));
      const lastTick = ticks.length > 0 ? ticks[ticks.length - 1] : undefined;

      overheadMatrix.push({
        source_id: row.source_id,
        source_name: row.source_name,
        source_layer: row.source_layer,
        target_id: row.target_id,
        target_name: row.target_name,
        target_layer: row.target_layer,
        link_type: row.source_layer === 2 ? 'SAT_TO_STATION' : 'STATION_TO_CMD',
        trans_delay: transDelay,
        proc_delay: procDelay,
        extra_delay: lastTick ? lastTick.extra_delay : 0,
        total_overhead: lastTick ? lastTick.total_overhead : (transDelay + procDelay),
        link_status: (lastTick ? lastTick.status : row.link_status) as LinkStatus,
        avg_overhead: avgOverhead,
        max_overhead: maxOverhead,
        min_overhead: minOverhead,
        ticks,
        segments
      });
    }
  });

  // 5. 解算 attackMatrix (武器对全域节点的可打击窗口序列与实战叠加延时)
  const weapons: Weapon[] = [];
  activeDb.exec({
    sql: `SELECT * FROM weapons`,
    rowMode: 'object',
    callback: (row: any) => { weapons.push(row as Weapon); }
  });

  const blueAssets: Asset[] = [];
  activeDb.exec({
    sql: `SELECT id, layer, asset_class, lat, lng, alt, tle_data FROM assets WHERE side = 'BLUE'`,
    rowMode: 'object',
    callback: (row: any) => { blueAssets.push(row as Asset); }
  });

  // 查询推演中已实际成功发生的交战开火记录 (weapon_id 与关联资产)
  const executedEngagements = new Set<string>();
  activeDb.exec({
    sql: `
      SELECT e.weapon_id, cw.source_id, cw.target_id
      FROM engagements e
      JOIN communication_windows cw ON e.target_window_id = cw.id
      WHERE e.is_successful = 1
    `,
    rowMode: 'object',
    callback: (row: any) => {
      executedEngagements.add(`${row.weapon_id}::${row.source_id}`);
      executedEngagements.add(`${row.weapon_id}::${row.target_id}`);
    }
  });

  const attackMatrix: AttackMatrixItem[] = [];

  weapons.forEach(w => {
    blueAssets.forEach(a => {
      const theoreticalDelay = w.kill_type === 'HARD' ? 300 : 45; // 理论可造成延时
      const isExecuted = executedEngagements.has(`${w.id}::${a.id}`); // 实际是否已分配/开火打击
      const actualDelay = isExecuted ? theoreticalDelay : 0;          // 实际打击已叠加延时 (未打则为 0)

      if (w.category === 'CYBER') {
        // 网络协议攻击全时段有效
        attackMatrix.push({
          weapon_id: w.id,
          weapon_name: w.name,
          category: w.category,
          kill_type: w.kill_type,
          target_id: a.id,
          target_name: a.id,
          target_layer: a.layer,
          theoretical_delay: theoreticalDelay,
          actual_delay: actualDelay,
          is_executed: isExecuted,
          action_cost: w.action_cost,
          windows: [{ window_start: start_time, window_end: end_time }]
        });
      } else if (a.layer === 0 || a.layer === 1) {
        // 定向打击地基节点
        const aLat = a.lat || 24.5;
        const aLng = a.lng || 121.5;
        const dist = calculateDistance(w.base_lat, w.base_lng, aLat, aLng);
        if (w.max_range === -1 || (dist > 0 && dist <= w.max_range)) {
          attackMatrix.push({
            weapon_id: w.id,
            weapon_name: w.name,
            category: w.category,
            kill_type: w.kill_type,
            target_id: a.id,
            target_name: a.id,
            target_layer: a.layer,
            theoretical_delay: theoreticalDelay,
            actual_delay: actualDelay,
            is_executed: isExecuted,
            action_cost: w.action_cost,
            windows: [{ window_start: start_time, window_end: end_time }]
          });
        }
      } else if (a.layer === 2 && a.tle_data) {
        // 动态判定武器对高空卫星的有效打击窗口
        try {
          const lines = a.tle_data.split(/\r?\n|\\n/).map((l: string) => l.trim()).filter((l: string) => l.length > 0);
          if (lines.length >= 2) {
            const satrec = satellite.twoline2satrec(lines[0], lines[1]);
            const windows: { window_start: number; window_end: number }[] = [];
            let attackStart: number | null = null;

            for (let t = start_time; t <= end_time; t += time_step_seconds) {
              const date = new Date(t * 1000);
              const gmst = satellite.gstime(date);
              const posAndVel = satellite.propagate(satrec, date);
              if (posAndVel && posAndVel.position && typeof posAndVel.position !== 'boolean') {
                const geodetic = satellite.eciToGeodetic(posAndVel.position, gmst);
                const satLat = satellite.radiansToDegrees(geodetic.latitude);
                const satLng = satellite.radiansToDegrees(geodetic.longitude);
                const dist = calculateDistance(w.base_lat, w.base_lng, satLat, satLng);

                const inRange = w.max_range === -1 || (dist > 0 && dist <= w.max_range);
                if (inRange) {
                  if (attackStart === null) attackStart = t;
                } else {
                  if (attackStart !== null) {
                    if (t > attackStart) {
                      windows.push({ window_start: attackStart, window_end: t });
                    }
                    attackStart = null;
                  }
                }
              }
            }
            if (attackStart !== null && end_time > attackStart) {
              windows.push({ window_start: attackStart, window_end: end_time });
            }
            if (windows.length > 0) {
              attackMatrix.push({
                weapon_id: w.id,
                weapon_name: w.name,
                category: w.category,
                kill_type: w.kill_type,
                target_id: a.id,
                target_name: a.id,
                target_layer: a.layer,
                theoretical_delay: theoreticalDelay,
                actual_delay: actualDelay,
                is_executed: isExecuted,
                action_cost: w.action_cost,
                windows
              });
            }
          }
        } catch (e) {
          console.error(`Error calculating attackMatrix for ${w.id} -> ${a.id}:`, e);
        }
      }
    });
  });

  // 6. 解算 earliestFullChain (蓝方最早完成一次全链路传输分析及武器影响归因)
  let earliestFullChain: EarliestFullChainAnalysis | undefined = undefined;
  try {
    const satToStationLinks = overheadMatrix.filter(item => item.link_type === 'SAT_TO_STATION');
    const stationToCmdLinks = overheadMatrix.filter(item => item.link_type === 'STATION_TO_CMD');

    // 获取所有武器名称字典供归因匹配
    const weaponMap = new Map<string, Weapon>();
    weapons.forEach(w => weaponMap.set(w.id, w));

    // 获取所有资产 ID 字典
    const assetNameMap = new Map<string, string>();
    activeDb.exec({
      sql: `SELECT id FROM assets`,
      rowMode: 'object',
      callback: (r: any) => { assetNameMap.set(r.id, r.id); }
    });

    let bestCombination: {
      optimalStartTime: number;
      earliestFinishTime: number;
      totalBaselineOverhead: number;
      actualDelay: number;
      pathNodes: string[];
      pathNodeNames: string[];
      pathLinkIds: string[];
      satLink: OverheadMatrixItem;
      stationLink: OverheadMatrixItem;
    } | null = null;

    let minFinishTime = Infinity;

    // 寻找在受到干扰/打压后，实际最早完成全链路传输的最佳链路组合与发射时刻 t0
    satToStationLinks.forEach(satLink => {
      stationToCmdLinks.forEach(stationLink => {
        // 匹配地面接收站节点衔接: Sat -> Station 且 Station -> Cmd
        if (satLink.target_id === stationLink.source_id) {
          const baseline1 = satLink.trans_delay + satLink.proc_delay;
          const baseline2 = stationLink.trans_delay + stationLink.proc_delay;
          const totalBaselineOverhead = baseline1 + baseline2;

          for (let i = 0; i < satLink.ticks.length; i++) {
            const tick1 = satLink.ticks[i];
            const t0 = tick1.time;
            const delay1 = tick1.total_overhead;
            const t1 = t0 + delay1;

            // 匹配第二跳在 t1 时刻处的时延开销
            const tick2Index = Math.min(
              stationLink.ticks.length - 1,
              Math.max(0, Math.floor((t1 - start_time) / time_step_seconds))
            );
            const tick2 = stationLink.ticks[tick2Index];
            const delay2 = tick2 ? tick2.total_overhead : baseline2;
            const actualDelay = delay1 + delay2;
            const finishTime = t0 + actualDelay;

            if (finishTime < minFinishTime) {
              minFinishTime = finishTime;
              const satName = assetNameMap.get(satLink.source_id) || satLink.source_id;
              const stationName = assetNameMap.get(satLink.target_id) || satLink.target_id;
              const cmdName = assetNameMap.get(stationLink.target_id) || stationLink.target_id;

              bestCombination = {
                optimalStartTime: t0,
                earliestFinishTime: finishTime,
                totalBaselineOverhead,
                actualDelay,
                pathNodes: [satLink.source_id, satLink.target_id, stationLink.target_id],
                pathNodeNames: [satName, stationName, cmdName],
                pathLinkIds: [
                  `${satLink.source_id}::${satLink.target_id}`,
                  `${stationLink.source_id}::${stationLink.target_id}`
                ],
                satLink,
                stationLink
              };
            }
          }
        }
      });
    });

    if (bestCombination) {
      const {
        optimalStartTime,
        earliestFinishTime,
        totalBaselineOverhead,
        actualDelay,
        pathNodes,
        pathNodeNames,
        pathLinkIds
      } = bestCombination;

      const delayDelta = actualDelay - totalBaselineOverhead;
      const attributions: FullChainAttribution[] = [];

      // 从 engagements 中检索落在该全链路传输时间窗口内的成功武器打击记录
      activeDb.exec({
        sql: `
          SELECT e.action_time, e.weapon_id, w.name as weapon_name, w.category, w.kill_type, cw.target_id, a.id as target_name
          FROM engagements e
          JOIN weapons w ON e.weapon_id = w.id
          JOIN communication_windows cw ON e.target_window_id = cw.id
          JOIN assets a ON cw.target_id = a.id OR cw.source_id = a.id
          WHERE e.is_successful = 1
            AND e.action_time >= ? AND e.action_time <= ?
            AND (a.id = ? OR a.id = ?)
        `,
        bind: [optimalStartTime, earliestFinishTime, pathNodes[0], pathNodes[1]],
        rowMode: 'object',
        callback: (r: any) => {
          const impact = r.kill_type === 'HARD' ? 300 : 45;
          const targetName = assetNameMap.get(r.target_id) || r.target_id;
          attributions.push({
            time: r.action_time,
            minute: Math.floor((r.action_time - start_time) / 60),
            weapon_id: r.weapon_id,
            weapon_name: r.weapon_name,
            category: r.category as WeaponCategory,
            kill_type: r.kill_type as KillType,
            target_id: r.target_id,
            target_name: targetName,
            delay_impact: impact
          });
        }
      });

      const optimalStartMin = Math.floor((optimalStartTime - start_time) / 60);
      const earliestFinishMin = Math.floor((earliestFinishTime - start_time) / 60);
      const baselineFinishTime = optimalStartTime + totalBaselineOverhead;
      const baselineFinishMin = Math.floor((baselineFinishTime - start_time) / 60);

      earliestFullChain = {
        optimalStartTime,
        optimalStartMin,
        earliestFinishTime,
        earliestFinishMin,
        baselineFinishTime,
        baselineFinishMin,
        totalBaselineOverhead,
        actualDelay,
        delayDelta,
        pathNodes,
        pathNodeNames,
        pathLinkIds,
        attributions
      };
    }
  } catch (err) {
    console.error('Error calculating earliestFullChain:', err);
  }

  return {
    passMatrix,
    visibleMatrix,
    overheadMatrix,
    attackMatrix,
    earliestFullChain
  };
}

// 监听主线程的消息
addEventListener("message", (event: MessageEvent<WorkerRequest>) => {
  const { type, id, sql, params } = event.data;

  //如果是INIT则初始化数据库
  if (type === "INIT") {
    initDb();
    return;
  }

  if (!db) {
    postMessage({
      id,
      type: "ERROR",
      error: "Database is not initialized yet.",
    });
    return;
  }

  // 1. 轨道计算视算特殊处理
  if (type === "CALCULATE_WINDOWS") {
    try {
      const scenarioId = params[0] as string;

      const scenarios: ScenarioTimeConfig[] = [];
      db.exec({
        sql: `SELECT start_time, end_time, time_step_seconds FROM scenarios WHERE id = ?`,
        bind: [scenarioId],
        rowMode: "object",
        callback: (row: any) => {
          scenarios.push(row as ScenarioTimeConfig);
        },
      });
      if (scenarios.length === 0) {
        throw new Error(`Scenario ${scenarioId} not found`);
      }
      const { start_time, end_time, time_step_seconds } = scenarios[0];

      const satellites: SatTleInfo[] = [];
      db.exec({
        sql: `SELECT id, tle_data FROM assets WHERE layer = 2 AND tle_data IS NOT NULL`,
        rowMode: "object",
        callback: (row: any) => {
          satellites.push(row as SatTleInfo);
        },
      });

      const stations: StationInfo[] = [];
      db.exec({
        sql: `SELECT id, lat, lng, alt, terrain_mask_angle FROM assets WHERE layer IN (0, 1) AND lat IS NOT NULL AND lng IS NOT NULL`,
        rowMode: "object",
        callback: (row: any) => {
          stations.push(row as StationInfo);
        },
      });

      db.exec({
        sql: `DELETE FROM communication_windows WHERE scenario_id = ? AND id NOT LIKE 'link-static-%'`,
        bind: [scenarioId],
      });

      const activeWindows = new Map<string, number>();

      const satrecs = satellites
        .map((sat) => {
          try {
            const lines = sat.tle_data
              .split(/\r?\n|\\n/)
              .map((l: string) => l.trim())
              .filter((l: string) => l.length > 0);
            if (lines.length < 2) return null;
            const satrec = satellite.twoline2satrec(lines[0], lines[1]);
            return { id: sat.id, satrec };
          } catch (e) {
            console.error(`Error parsing TLE for ${sat.id}:`, e);
            return null;
          }
        })
        .filter(Boolean) as { id: string; satrec: satellite.SatRec }[];

      db.exec("BEGIN TRANSACTION;");
      try {
        for (let t = start_time; t <= end_time; t += time_step_seconds) {
          const date = new Date(t * 1000);
          const gmst = satellite.gstime(date);

          for (const sat of satrecs) {
            const posAndVel = satellite.propagate(sat.satrec, date);
            if (!posAndVel) {
              continue;
            }
            const posEci = posAndVel.position;

            if (!posEci || typeof posEci === "boolean") {
              continue;
            }

            const posEcf = satellite.eciToEcf(posEci, gmst);

            for (const station of stations) {
              const observerGeodetic = {
                latitude: satellite.degreesToRadians(station.lat),
                longitude: satellite.degreesToRadians(station.lng),
                height: station.alt || 0,
              };

              const lookAngles = satellite.ecfToLookAngles(
                observerGeodetic,
                posEcf,
              );
              const elevation = satellite.radiansToDegrees(
                lookAngles.elevation,
              );

              const key = `${sat.id}::${station.id}`;
              const mask = station.terrain_mask_angle || 10.0;
              const isVisible = elevation >= mask;

              if (isVisible) {
                if (!activeWindows.has(key)) {
                  activeWindows.set(key, t);
                }
              } else {
                if (activeWindows.has(key)) {
                  const start = activeWindows.get(key)!;
                  activeWindows.delete(key);
                  const windowId = `win-${sat.id}-${station.id}-${start}`;
                  db.exec({
                    sql: `
                      INSERT INTO communication_windows (id, scenario_id, source_id, target_id, window_start, window_end, routing_converge_delay, link_status)
                      VALUES (?, ?, ?, ?, ?, ?, 30, 'TRANSMITTING')
                    `,
                    bind: [windowId, scenarioId, sat.id, station.id, start, t],
                  });
                }
              }
            }
          }
        }

        for (const [key, start] of activeWindows.entries()) {
          const [satId, stationId] = key.split("::");
          const windowId = `win-${satId}-${stationId}-${start}`;
          db.exec({
            sql: `
              INSERT INTO communication_windows (id, scenario_id, source_id, target_id, window_start, window_end, routing_converge_delay, link_status)
              VALUES (?, ?, ?, ?, ?, ?, 30, 'TRANSMITTING')
            `,
            bind: [windowId, scenarioId, satId, stationId, start, end_time],
          });
        }

        db.exec("COMMIT;");
      } catch (innerError) {
        try {
          db.exec("ROLLBACK;");
        } catch (e) { }
        throw innerError;
      }
      postMessage({ id, type: "SUCCESS", message: "轨道视算计算完成" });
    } catch (error) {
      console.error("Calculation Error:", error);
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      postMessage({ id, type: "ERROR", error: errorMessage });
    }
    return;
  }

  // 新增：更新卫星位置计算
  if (type === "UPDATE_SATELLITE_POSITIONS") {
    try {
      const currentTime = params[0] as number;
      const date = new Date(currentTime * 1000);
      const gmst = satellite.gstime(date);

      const satellites: SatTleInfo[] = [];
      db.exec({
        sql: `SELECT id, tle_data FROM assets WHERE layer = 2 AND tle_data IS NOT NULL`,
        rowMode: "object",
        callback: (row: any) => {
          satellites.push(row as SatTleInfo);
        },
      });

      db.exec("BEGIN TRANSACTION;");
      try {
        for (const sat of satellites) {
          try {
            const lines = sat.tle_data
              .split(/\r?\n|\\n/)
              .map((l: string) => l.trim())
              .filter((l: string) => l.length > 0);
            if (lines.length < 2) continue;
            const satrec = satellite.twoline2satrec(lines[0], lines[1]);
            const posAndVel = satellite.propagate(satrec, date);
            if (!posAndVel) {
              continue;
            }
            const posEci = posAndVel.position;

            if (posEci && typeof posEci !== "boolean") {
              const positionGeodetic = satellite.eciToGeodetic(posEci, gmst);
              const lat = satellite.radiansToDegrees(positionGeodetic.latitude);
              const lng = satellite.radiansToDegrees(
                positionGeodetic.longitude,
              );

              db.exec({
                sql: `UPDATE assets SET lat = ?, lng = ? WHERE id = ?`,
                bind: [lat, lng, sat.id],
              });
            }
          } catch (e) {
            console.error(`Error updating position for ${sat.id}:`, e);
          }
        }
        db.exec("COMMIT;");
      } catch (innerError) {
        try {
          db.exec("ROLLBACK;");
        } catch (e) { }
        throw innerError;
      }
      postMessage({ id, type: "SUCCESS" });
    } catch (error) {
      console.error("Update Satellite Positions Error:", error);
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      postMessage({ id, type: "ERROR", error: errorMessage });
    }
    return;
  }

  // 2. 自动武器分配交战判定特殊处理
  if (type === "AUTO_ALLOCATE_WEAPONS") {
    try {
      const { intensity, currentTime, scenarioId, scenarioEndTime } =
        params[0] as {
          intensity: string;
          currentTime: number;
          scenarioId: string;
          scenarioEndTime: number;
        };
      const result = autoAllocateWeapons(
        intensity,
        currentTime,
        scenarioId,
        scenarioEndTime,
      );
      postMessage({ id, type: "SUCCESS", result });
    } catch (error) {
      console.error("Weapon Allocation Error:", error);
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      postMessage({ id, type: "ERROR", error: errorMessage });
    }
    return;
  }

  // 3. 算力矩阵解算处理
  if (type === "GENERATE_MATRICES") {
    try {
      const scenarioId = (params && params[0]) || "scen-001";
      const matrices = generateMatrices(scenarioId);
      postMessage({ id, type: "SUCCESS", result: matrices });
    } catch (error) {
      console.error("Generate Matrices Error:", error);
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      postMessage({ id, type: "ERROR", error: errorMessage });
    }
    return;
  }

  // 4. 常规 SQL 命令处理
  try {
    if (type === "QUERY") {
      if (!sql) {
        throw new Error("SQL statement is required for QUERY action.");
      }
      const result: Record<string, unknown>[] = [];
      db.exec({
        sql,
        bind: params || [],
        rowMode: "object",
        callback: (row: any) => {
          result.push(row as Record<string, unknown>);
        },
      });
      postMessage({ id, type: "SUCCESS", result });
    } else if (type === "EXEC") {
      if (!sql) {
        throw new Error("SQL statement is required for EXEC action.");
      }
      db.exec({
        sql,
        bind: params || [],
      });
      postMessage({ id, type: "SUCCESS", changes: db.changes() });
    }
  } catch (error) {
    console.error(`SQL execute error: [${sql}]`, error);
    const errorMessage = error instanceof Error ? error.message : String(error);
    postMessage({
      id,
      type: "ERROR",
      error: errorMessage,
    });
  }
});
