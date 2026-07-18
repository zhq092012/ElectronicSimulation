import sqlite3InitModule from '@sqlite.org/sqlite-wasm';
import * as satellite from 'satellite.js';
import ddlSchema from '../db/schema.sql?raw';

let db: any = null;

/**
 * 初始化 SQLite Wasm 与 OPFS 数据库
 */
async function initDb() {
  try {
    // 强制转换为 any 绕过 TypeScript 声明文件不匹配的问题
    const sqlite3 = await (sqlite3InitModule as any)({
      locateFile: () => {
        // 定位到 public 目录下的 WebAssembly 资源，无须传入参数
        return `/sqlite3.wasm`;
      }
    });

    console.log('SQLite Wasm version:', sqlite3.version.libVersion);
    
    // 打开 OPFS 数据库 (如果不存在则自动创建)
    db = new sqlite3.oo1.OpfsDb('/cema_wargame_v2.db', 'c');
    console.log('SQLite OPFS Database opened:', db.filename);

    // 逐句执行 schema.sql 初始化数据库表
    const statements = ddlSchema
      .split(';')
      .map(s => s.trim())
      .filter(s => s.length > 0);

    // 开启事务以加速建表过程
    db.exec('BEGIN TRANSACTION;');
    for (const stmt of statements) {
      db.exec(stmt);
    }
    db.exec('COMMIT;');
    
    console.log('Database tables successfully initialized.');
    postMessage({ type: 'INIT_SUCCESS' });
  } catch (error: any) {
    console.error('SQLite Worker Init Error:', error);
    postMessage({ type: 'INIT_ERROR', error: error.message || String(error) });
  }
}

/**
 * 球面半正矢公式 (Haversine Formula) 求解经纬度空间球面距离 (km)
 */
function calculateDistance(lat1: number, lng1: number, lat2: number, lng2: number): number {
  if (lat1 === 0 && lng1 === 0) return -1; // 网络武器无物理距离限制
  const R = 6371; // 地球半径 (km)
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = 
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * 
    Math.sin(dLng / 2) * Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

/**
 * 核心推运对抗战术引擎 (Event Loop 打击判定与背包背包分配)
 */
function autoAllocateWeapons(intensity: string, currentTime: number, scenarioId: string) {
  // 1. 获取红方已被电子侦察发现的蓝方资产
  const assets: any[] = [];
  db.exec({
    sql: `SELECT * FROM assets WHERE side = 'BLUE' AND is_detected_by_red = 1 AND anti_jam_level > 0`,
    rowMode: 'object',
    callback: (row: any) => { assets.push(row); }
  });

  if (assets.length === 0) {
    return { engagements_created: 0 };
  }

  // 动态解算价值权重优先级
  assets.forEach(asset => {
    let score = asset.base_priority || 50;
    if (asset.usage_type === 'MILITARY') score += 30;
    if (asset.func_type === 'COMM' || asset.func_type === 'RELAY') score += 20;
    if (asset.layer === 2) score += 15; // 卫星
    asset.calculated_priority = score;
  });

  // 按价值权重从高到低排序 (背包算法前置条件)
  assets.sort((a, b) => b.calculated_priority - a.calculated_priority);

  // 2. 获取红方武器库
  const weapons: any[] = [];
  db.exec({
    sql: `SELECT * FROM weapons`,
    rowMode: 'object',
    callback: (row: any) => { weapons.push(row); }
  });

  // 根据当前推演烈度过滤红方可用武器
  const allowedWeapons = weapons.filter(w => {
    if (intensity === 'LOW') {
      return (w.category === 'EW' || w.category === 'CYBER') && w.kill_type === 'SOFT';
    } else if (intensity === 'MEDIUM') {
      return (w.category === 'EW' || w.category === 'CYBER' || w.category === 'DEW');
    }
    return true; // HIGH 烈度全开 (包括动能导弹)
  });

  // 3. 获取当前分钟 (Tick) 正在正常通信的活跃链路窗口
  const activeWindows: any[] = [];
  db.exec({
    sql: `SELECT * FROM communication_windows WHERE scenario_id = ? AND ? BETWEEN window_start AND window_end AND link_status != 'DESTROYED'`,
    bind: [scenarioId, currentTime],
    rowMode: 'object',
    callback: (row: any) => { activeWindows.push(row); }
  });

  if (activeWindows.length === 0) {
    return { engagements_created: 0 };
  }

  db.exec('BEGIN TRANSACTION;');
  let engagementsCount = 0;

  for (const asset of assets) {
    // 找出与该资产相连的所有活动链路
    const connectedLinks = activeWindows.filter(link => 
      link.source_id === asset.id || link.target_id === asset.id
    );

    if (connectedLinks.length === 0) continue;

    // 贪心匹配最适用的打击武器
    let selectedWeapon: any = null;
    let computedDistance = 0;

    for (const weapon of allowedWeapons) {
      if (weapon.inventory === 0) continue; // 弹药已耗尽

      let dist = -1;
      if (weapon.category !== 'CYBER') {
        const assetLat = asset.lat !== null ? asset.lat : 24.5;
        const assetLng = asset.lng !== null ? asset.lng : 121.5;
        dist = calculateDistance(weapon.base_lat, weapon.base_lng, assetLat, assetLng);
        
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
          bind: [selectedWeapon.inventory, selectedWeapon.id]
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
      const attenuation_att = 0.90;

      // 解算最终有效干信比 (J/S Ratio)
      // 假定干扰开机基准功率为 3000W，蓝方通信基准功率为 0.05W
      const P_jam = 3000;
      const P_sig = 0.05;
      const js = 10 * Math.log10((P_jam * attenuation_dist * attenuation_terrain * attenuation_alt * attenuation_vel * attenuation_att) / P_sig);
      const final_js = Math.round(js * 100) / 100;

      // 打击判定: 干信比超过接收机抗干扰等级为成功拦截
      const threshold = asset.anti_jam_level || 50;
      const isSuccessful = final_js >= threshold ? 1 : 0;

      const engageId = `engage-${selectedWeapon.id}-${asset.id}-${currentTime}`;
      const targetWindowId = connectedLinks[0].id;

      // 写入交战日志表
      db.exec({
        sql: `
          INSERT INTO engagements (id, plan_id, weapon_id, target_window_id, action_time, attenuation_dist, attenuation_terrain, attenuation_alt, attenuation_vel, attenuation_att, final_js_ratio, is_successful)
          VALUES (?, 'plan-001', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
        bind: [
          engageId, selectedWeapon.id, targetWindowId, currentTime,
          attenuation_dist, attenuation_terrain, attenuation_alt,
          attenuation_vel, attenuation_att, final_js, isSuccessful
        ]
      });

      engagementsCount += 1;

      // 判定成功：更新链路及资产状态
      if (isSuccessful === 1) {
        const newStatus = selectedWeapon.kill_type === 'HARD' ? 'DESTROYED' : 'JAMMED';
        
        // 更新受影响链路状态
        db.exec({
          sql: `
            UPDATE communication_windows 
            SET link_status = ? 
            WHERE scenario_id = ? AND ? BETWEEN window_start AND window_end
              AND (source_id = ? OR target_id = ?)
          `,
          bind: [newStatus, scenarioId, currentTime, asset.id, asset.id]
        });

        // 如果被硬物理摧毁，更新资产本身等级为 0
        if (selectedWeapon.kill_type === 'HARD') {
          db.exec({
            sql: `UPDATE assets SET anti_jam_level = 0, base_priority = 0 WHERE id = ?`,
            bind: [asset.id]
          });
        }

        // 累计 tactical_plans 效能和开支
        const delayAdded = selectedWeapon.kill_type === 'HARD' ? 480 : 120;
        const destroyedAdded = selectedWeapon.kill_type === 'HARD' ? 1 : 0;
        db.exec({
          sql: `
            UPDATE tactical_plans 
            SET total_cost = total_cost + ?,
                total_delay_achieved = total_delay_achieved + ?,
                nodes_destroyed = nodes_destroyed + ?
            WHERE id = 'plan-001'
          `,
          bind: [selectedWeapon.action_cost, delayAdded, destroyedAdded]
        });
      }
    }
  }

  db.exec('COMMIT;');
  return { engagements_created: engagementsCount };
}

// 监听主线程的消息
addEventListener('message', (event: MessageEvent) => {
  const { type, id, sql, params } = event.data;

  if (type === 'INIT') {
    initDb();
    return;
  }

  if (!db) {
    postMessage({
      id,
      type: 'ERROR',
      error: 'Database is not initialized yet.'
    });
    return;
  }

  // 1. 轨道计算视算特殊处理
  if (type === 'CALCULATE_WINDOWS') {
    try {
      const scenarioId = params[0];
      
      const scenarios: any[] = [];
      db.exec({
        sql: `SELECT start_time, end_time, time_step_seconds FROM scenarios WHERE id = ?`,
        bind: [scenarioId],
        rowMode: 'object',
        callback: (row: any) => { scenarios.push(row); }
      });
      if (scenarios.length === 0) {
        throw new Error(`Scenario ${scenarioId} not found`);
      }
      const { start_time, end_time, time_step_seconds } = scenarios[0];

      const satellites: any[] = [];
      db.exec({
        sql: `SELECT id, tle_data FROM assets WHERE layer = 2 AND tle_data IS NOT NULL`,
        rowMode: 'object',
        callback: (row: any) => { satellites.push(row); }
      });

      const stations: any[] = [];
      db.exec({
        sql: `SELECT id, lat, lng, alt, terrain_mask_angle FROM assets WHERE layer IN (0, 1) AND lat IS NOT NULL AND lng IS NOT NULL`,
        rowMode: 'object',
        callback: (row: any) => { stations.push(row); }
      });

      db.exec({
        sql: `DELETE FROM communication_windows WHERE scenario_id = ? AND id NOT LIKE 'link-static-%'`,
        bind: [scenarioId]
      });

      const activeWindows = new Map<string, number>(); 
      
      const satrecs = satellites.map(sat => {
        try {
          const lines = sat.tle_data.split(/\r?\n|\\n/).map((l: string) => l.trim()).filter((l: string) => l.length > 0);
          if (lines.length < 2) return null;
          const satrec = satellite.twoline2satrec(lines[0], lines[1]);
          return { id: sat.id, satrec };
        } catch (e: any) {
          console.error(`Error parsing TLE for ${sat.id}:`, e);
          return null;
        }
      }).filter(Boolean) as any[];

      db.exec('BEGIN TRANSACTION;');

      for (let t = start_time; t <= end_time; t += time_step_seconds) {
        const date = new Date(t * 1000);
        const gmst = satellite.gstime(date);

        for (const sat of satrecs) {
          const posAndVel = satellite.propagate(sat.satrec, date);
          const posEci = posAndVel.position;

          if (!posEci || typeof posEci === 'boolean') {
            continue;
          }

          const posEcf = satellite.eciToEcf(posEci, gmst);

          for (const station of stations) {
            const observerGeodetic = {
              latitude: satellite.degreesToRadians(station.lat),
              longitude: satellite.degreesToRadians(station.lng),
              height: station.alt || 0 
            };

            const observerEcf = satellite.geodeticToEcf(observerGeodetic);
            const lookAngles = satellite.ecfToLookAngles(observerEcf, posEcf);
            const elevation = satellite.radiansToDegrees(lookAngles.elevation);

            const key = `${sat.id}-${station.id}`;
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
                  bind: [windowId, scenarioId, sat.id, station.id, start, t]
                });
              }
            }
          }
        }
      }

      for (const [key, start] of activeWindows.entries()) {
        const [satId, stationId] = key.split('-');
        const windowId = `win-${satId}-${stationId}-${start}`;
        db.exec({
          sql: `
            INSERT INTO communication_windows (id, scenario_id, source_id, target_id, window_start, window_end, routing_converge_delay, link_status)
            VALUES (?, ?, ?, ?, ?, ?, 30, 'TRANSMITTING')
          `,
          bind: [windowId, scenarioId, satId, stationId, start, end_time]
        });
      }

      db.exec('COMMIT;');
      postMessage({ id, type: 'SUCCESS', message: '轨道视算计算完成' });
    } catch (error: any) {
      db.exec('ROLLBACK;');
      console.error('Calculation Error:', error);
      postMessage({ id, type: 'ERROR', error: error.message || String(error) });
    }
    return;
  }

  // 2. 自动武器分配交战判定特殊处理
  if (type === 'AUTO_ALLOCATE_WEAPONS') {
    try {
      const { intensity, currentTime, scenarioId } = params[0];
      const result = autoAllocateWeapons(intensity, currentTime, scenarioId);
      postMessage({ id, type: 'SUCCESS', result });
    } catch (error: any) {
      console.error('Weapon Allocation Error:', error);
      postMessage({ id, type: 'ERROR', error: error.message || String(error) });
    }
    return;
  }

  // 3. 常规 SQL 命令处理
  try {
    if (type === 'QUERY') {
      const result: any[] = [];
      db.exec({
        sql,
        bind: params || [],
        rowMode: 'object', 
        callback: (row: any) => {
          result.push(row);
        }
      });
      postMessage({ id, type: 'SUCCESS', result });
    } else if (type === 'EXEC') {
      db.exec({
        sql,
        bind: params || []
      });
      postMessage({ id, type: 'SUCCESS', changes: db.changes() });
    }
  } catch (error: any) {
    console.error(`SQL execute error: [${sql}]`, error);
    postMessage({
      id,
      type: 'ERROR',
      error: error.message || String(error)
    });
  }
});
