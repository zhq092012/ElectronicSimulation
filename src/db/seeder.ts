/**
 * 战术数据初始化脚本 (Seed Data for Sprint 3)
 */

export const seedMockData = async (sqliteClient: any): Promise<void> => {
  console.log('开始执行兵棋推演数据初始化...');
  
  // 1. 清空各表旧数据 (遵循外键删除级联关系)
  await sqliteClient.execute('DELETE FROM engagements');
  await sqliteClient.execute('DELETE FROM tactical_plans');
  await sqliteClient.execute('DELETE FROM communication_windows');
  await sqliteClient.execute('DELETE FROM weapons');
  await sqliteClient.execute('DELETE FROM assets');
  await sqliteClient.execute('DELETE FROM scenarios');

  // 2. 插入战役场景场景记录 (scen-001, 时长 50 分钟)
  // 开始时间设定为 1781683200 (2026年7月18日 08:00:00 UTC)
  const startTime = 1781683200;
  const endTime = startTime + 50 * 60; // 50分钟后 (3000秒)
  
  await sqliteClient.execute(`
    INSERT INTO scenarios (id, name, min_lat, max_lat, min_lng, max_lng, start_time, end_time, max_budget, time_step_seconds)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `, [
    'scen-001', '海峡东部多域对空电磁对抗演练 (Sprint 3)', 
    22.0, 26.0, 119.0, 123.0, 
    startTime, endTime, 
    600000.0, 60
  ]);

  // 3. 插入 15 条蓝方立体防御物理资产 (5 卫星 + 3 中继机 + 5 接收站 + 2 指挥中心)
  // LEO 卫星包含真实的 Starlink TLE 轨道根数
  await sqliteClient.execute(`
    INSERT INTO assets (id, side, layer, asset_class, func_type, usage_type, lat, lng, alt, tle_data, terrain_mask_angle, anti_jam_level, base_priority, is_detected_by_red)
    VALUES 
    -- 5 颗蓝方低轨通信卫星 (Layer = 2, 带有 Starlink TLE 数据)
    ('sat-starlink-01', 'BLUE', 2, 'SATELLITE', 'COMM', 'MILITARY', NULL, NULL, 550.0, 
     '1 56834U 23079A   26198.54238426  .00008425  00000-0  57685-3 0  9997\\n2 56834  43.0012 300.1245 0001423  95.4215 264.8912 15.02451290123456', 
     10.0, 65, 80, 1),
    ('sat-starlink-02', 'BLUE', 2, 'SATELLITE', 'COMM', 'MILITARY', NULL, NULL, 552.0, 
     '1 56835U 23079B   26198.55349537  .00008536  00000-0  58491-3 0  9998\\n2 56835  43.0023 300.2356 0001534  96.5326 265.9023 15.02562391123457', 
     10.0, 60, 80, 1),
    ('sat-starlink-03', 'BLUE', 2, 'SATELLITE', 'COMM', 'CIVIL_COMMERCIAL', NULL, NULL, 548.0, 
     '1 56839U 23079F   26198.59793979  .00008979  00000-0  61715-3 0  9999\\n2 56839  43.0067 300.6789 0001978  99.9767 269.3467 15.03016795123461', 
     10.0, 55, 75, 1),
    ('sat-starlink-04', 'BLUE', 2, 'SATELLITE', 'COMM', 'MILITARY', NULL, NULL, 555.0, 
     '1 56842U 23079J   26198.63127202  .00009312  00000-0  63992-3 0  9990\\n2 56842  43.0098 301.0123 0002201 102.3098 271.6789 15.03358901123464', 
     10.0, 70, 85, 1),
    ('sat-starlink-05', 'BLUE', 2, 'SATELLITE', 'COMM', 'CIVIL_COMMERCIAL', NULL, NULL, 545.0, 
     '1 56848U 23079P   26198.69793979  .00009979  00000-0  68991-3 0  9991\\n2 56848  43.0167 301.7123 0002712 107.8123 277.1234 15.04012308123470', 
     10.0, 50, 70, 1),

    -- 3 架空中中继机/无人机 (Layer = 1)
    ('relay-drone-01', 'BLUE', 1, 'DRONE', 'RELAY', 'MILITARY', 23.8, 121.8, 18.5, NULL, 5.0, 45, 60, 0),
    ('relay-drone-02', 'BLUE', 1, 'DRONE', 'RELAY', 'MILITARY', 24.5, 122.2, 20.0, NULL, 5.0, 50, 65, 0),
    ('relay-drone-03', 'BLUE', 1, 'DRONE', 'RELAY', 'MILITARY', 25.2, 121.3, 15.0, NULL, 5.0, 40, 55, 0),

    -- 5 个雷达/地基接收站 (Layer = 0, 设定掩蔽角为 10 度)
    ('station-hualien', 'BLUE', 0, 'STATION', 'COMM', 'CIVIL_COMMERCIAL', 24.0, 121.6, 0.05, NULL, 10.0, 50, 45, 1),
    ('station-hengchun', 'BLUE', 0, 'STATION', 'COMM', 'MILITARY', 22.0, 120.7, 0.08, NULL, 10.0, 60, 50, 1),
    ('station-keelung', 'BLUE', 0, 'STATION', 'COMM', 'CIVIL_COMMERCIAL', 25.1, 121.7, 0.03, NULL, 10.0, 45, 40, 1),
    ('station-taitung', 'BLUE', 0, 'STATION', 'COMM', 'MILITARY', 22.8, 121.1, 0.12, NULL, 10.0, 70, 55, 1),
    ('station-penghu', 'BLUE', 0, 'STATION', 'COMM', 'CIVIL_COMMERCIAL', 23.6, 119.6, 0.04, NULL, 10.0, 50, 65, 1),

    -- 2 个战术联合指挥控制中心 (Layer = 0)
    ('cmd-taipei', 'BLUE', 0, 'COMMAND_CENTER', 'OTHER', 'MILITARY', 25.0, 121.5, 0.04, NULL, 0.0, 80, 95, 1),
    ('cmd-zuoying', 'BLUE', 0, 'COMMAND_CENTER', 'OTHER', 'MILITARY', 22.7, 120.3, 0.02, NULL, 0.0, 75, 90, 1)
  `);

  // 4. 插入 4 种红方跨域武器 (EMP, 网络黑客, 电磁干扰车, 反卫星导弹)
  await sqliteClient.execute(`
    INSERT INTO weapons (id, name, category, kill_type, base_lat, base_lng, max_range, inventory, action_cost, political_risk)
    VALUES 
    ('weapon-emp', 'HPM-500高功率微波电磁脉冲波武器', 'DEW', 'SOFT', 24.4, 118.2, 200.0, 5, 12000.0, 0.5),
    ('weapon-hacker', '“特洛伊-2.0”协议劫持木马', 'CYBER', 'SOFT', 0.0, 0.0, -1.0, -1, 2500.0, 0.1),
    ('weapon-jammer', '雷霆-600车载型超宽带定向干扰车', 'EW', 'SOFT', 24.1, 118.8, 380.0, -1, 1500.0, 0.2),
    ('weapon-hq19', 'HQ-19直升式反卫星拦截导弹', 'KINETIC', 'HARD', 23.5, 117.0, 2000.0, 2, 120000.0, 0.9)
  `);

  // 5. 插入初始作战计划
  await sqliteClient.execute(`
    INSERT INTO tactical_plans (id, scenario_id, name, intensity_level, total_cost, total_delay_achieved, nodes_destroyed, final_score)
    VALUES ('plan-001', 'scen-001', '跨域多维阻断与压制方案', 'MEDIUM', 0.0, 0, 0, 0.0)
  `);

  // 6. 插入骨干链路 (静态网状连线)
  // 为了让 3D 拓扑图呈现出完整的空天地三层网络，此处硬编码下层骨干链路
  // (上层卫星到下层的动态链路会在 calculateWindows 轨道视算中自动生成)
  await sqliteClient.execute(`
    INSERT INTO communication_windows (id, scenario_id, source_id, target_id, window_start, window_end, routing_converge_delay, link_status)
    VALUES 
    -- 中继无人机 -> 雷达接收站
    ('link-static-1', 'scen-001', 'relay-drone-01', 'station-hualien', 0, 9999999999, 30, 'TRANSMITTING'),
    ('link-static-2', 'scen-001', 'relay-drone-01', 'station-keelung', 0, 9999999999, 30, 'TRANSMITTING'),
    ('link-static-3', 'scen-001', 'relay-drone-02', 'station-hualien', 0, 9999999999, 30, 'TRANSMITTING'),
    ('link-static-4', 'scen-001', 'relay-drone-02', 'station-taitung', 0, 9999999999, 30, 'TRANSMITTING'),
    ('link-static-5', 'scen-001', 'relay-drone-03', 'station-hengchun', 0, 9999999999, 30, 'TRANSMITTING'),
    ('link-static-6', 'scen-001', 'relay-drone-03', 'station-penghu', 0, 9999999999, 30, 'TRANSMITTING'),
    
    -- 雷达接收站 -> 战术指挥中心
    ('link-static-7', 'scen-001', 'station-hualien', 'cmd-taipei', 0, 9999999999, 30, 'TRANSMITTING'),
    ('link-static-8', 'scen-001', 'station-keelung', 'cmd-taipei', 0, 9999999999, 30, 'TRANSMITTING'),
    ('link-static-9', 'scen-001', 'station-taitung', 'cmd-zuoying', 0, 9999999999, 30, 'TRANSMITTING'),
    ('link-static-10', 'scen-001', 'station-hengchun', 'cmd-zuoying', 0, 9999999999, 30, 'TRANSMITTING'),
    ('link-static-11', 'scen-001', 'station-penghu', 'cmd-zuoying', 0, 9999999999, 30, 'TRANSMITTING')
  `);

  console.log('兵棋推演基础资产与武器数据加载完成！');
};
