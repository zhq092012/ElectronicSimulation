import sqlite3InitModule from "@sqlite.org/sqlite-wasm";
import * as satellite from "satellite.js";
import ddlSchema from "../db/schema.sql?raw";
import type {
  Asset,
  Weapon,
  CommunicationWindow,
  Scenario,
} from "../types/electronic";

interface Sqlite3ExecOptions {
  sql: string;
  bind?: unknown[];
  rowMode?: "object";
  callback?: (row: any) => void;
}

interface Sqlite3Database {
  filename: string;
  exec: (options: string | Sqlite3ExecOptions) => void;
  changes: () => number;
}

interface Sqlite3Library {
  version: {
    libVersion: string;
  };
  oo1: {
    OpfsDb: new (filename: string, flags: string) => Sqlite3Database;
  };
}

// 扩展了计算权重的 Asset 类型
interface CalculatedAsset extends Asset {
  calculated_priority?: number;
}

// 包含双行轨道数据(TLE)且非空的卫星信息
interface SatTleInfo {
  id: string;
  tle_data: string;
}

// 包含有效位置信息的地面/低空基底资产
interface StationInfo {
  id: string;
  lat: number;
  lng: number;
  alt: number | null;
  terrain_mask_angle: number;
}

type ScenarioTimeConfig = Pick<
  Scenario,
  "start_time" | "end_time" | "time_step_seconds"
>;

interface WorkerRequest {
  type:
    | "INIT"
    | "CALCULATE_WINDOWS"
    | "UPDATE_SATELLITE_POSITIONS"
    | "AUTO_ALLOCATE_WEAPONS"
    | "QUERY"
    | "EXEC";
  id?: string;
  sql?: string;
  params?: any;
}

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
      } catch (err) {}
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
 * 球面半正矢公式 (Haversine Formula) 求解经纬度空间球面距离 (km)
 */
function calculateDistance(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number,
): number {
  if (lat1 === 0 && lng1 === 0) return -1; // 网络武器无物理距离限制
  const R = 6371; // 地球半径 (km)
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) *
      Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

/**
 * 核心推运对抗战术引擎 (Event Loop 打击判定与背包分配)
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
    let score = asset.base_priority || 50;
    if (asset.usage_type === "MILITARY") score += 30;
    if (asset.func_type === "COMM" || asset.func_type === "RELAY") score += 20;
    if (asset.layer === 2) score += 15; // 卫星
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
        } catch (e) {}
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
        } catch (e) {}
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

  // 3. 常规 SQL 命令处理
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
