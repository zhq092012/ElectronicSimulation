-- Enable SQLite Foreign Key Support
PRAGMA foreign_keys = ON;

-- 1. scenarios (战役场景配置与全局约束表)
CREATE TABLE IF NOT EXISTS scenarios (
    id TEXT PRIMARY KEY NOT NULL,                                           -- 场景唯一 UUID
    name TEXT NOT NULL,                                                     -- 场景名称
    min_lat REAL NOT NULL,                                                  -- 战区视口边界纬度下限 ([-90.0, 90.0])
    max_lat REAL NOT NULL,                                                  -- 战区视口边界纬度上限 ([-90.0, 90.0])
    min_lng REAL NOT NULL,                                                  -- 战区视口边界经度下限 ([-180.0, 180.0])
    max_lng REAL NOT NULL,                                                  -- 战区视口边界经度上限 ([-180.0, 180.0])
    start_time INTEGER NOT NULL,                                            -- 推演演练开始时间戳 (Unix Timestamp in seconds)
    end_time INTEGER NOT NULL,                                              -- 推演演练结束时间戳 (Unix Timestamp in seconds)
    max_budget REAL,                                                        -- 红方允许的最大压制战术资源/资金上限 (NULL表示无上限)
    time_step_seconds INTEGER DEFAULT 60 NOT NULL,                          -- 仿真时钟步长，默认每步进1个Tick代表1分钟（60秒）
    
    CONSTRAINT chk_lat_range CHECK (min_lat >= -90.0 AND max_lat <= 90.0 AND min_lat <= max_lat),
    CONSTRAINT chk_lng_range CHECK (min_lng >= -180.0 AND max_lng <= 180.0 AND min_lng <= max_lng),
    CONSTRAINT chk_time_range CHECK (start_time < end_time),
    CONSTRAINT chk_time_step CHECK (time_step_seconds > 0)
);

-- 2. assets (空天地立体战场实体资产表)
CREATE TABLE IF NOT EXISTS assets (
    id TEXT PRIMARY KEY NOT NULL,                                           -- 资产唯一 UUID
    side TEXT NOT NULL,                                                     -- 阵营: 'RED' (红方) / 'BLUE' (蓝方)
    layer INTEGER NOT NULL,                                                 -- 立体分层: 0-地基层, 1-空基层, 2-天基层
    asset_class TEXT NOT NULL,                                              -- 物理形态分类: 'SATELLITE' (卫星), 'STATION' (地面站), 'DRONE' (无人机), 'COMMAND_CENTER' (指挥中心)
    func_type TEXT NOT NULL,                                                -- 核心功能分类: 'RECON' (侦察), 'COMM' (通信), 'RELAY' (中继), 'OTHER' (其他)
    usage_type TEXT NOT NULL,                                               -- 所有权用途分类: 'MILITARY' (军用), 'CIVIL_COMMERCIAL' (民用/商用两用)
    lat REAL,                                                               -- 纬度 ([-90.0, 90.0], 地面站与低空资产必填, 卫星可根据TLE初始计算)
    lng REAL,                                                               -- 经度 ([-180.0, 180.0], 地面站与低空资产必填, 卫星可根据TLE初始计算)
    alt REAL,                                                               -- 高度/海拔/轨道高度 (单位: km. 地面站默认0)
    tle_data TEXT,                                                          -- 卫星专属：标准的双行轨道根数 (两行以换行符分隔的字符串)
    terrain_mask_angle REAL DEFAULT 10.0 NOT NULL,                          -- 地面站专属物理门槛：地平线最低仰角掩蔽角 (度, 默认 10.0)
    anti_jam_level INTEGER DEFAULT 50 NOT NULL,                             -- 接收机抗干扰基准等级 (0-100, 默认 50)
    base_priority INTEGER DEFAULT 50 NOT NULL,                              -- 基础目标价值分 (0-100, 默认 50, 红方背包算法排序参考)
    is_detected_by_red INTEGER DEFAULT 1 NOT NULL,                          -- 战争迷雾：0-隐蔽未发现，1-已被红方电子侦察发现 (默认 1)

    CONSTRAINT chk_side CHECK (side IN ('RED', 'BLUE')),
    CONSTRAINT chk_layer CHECK (layer IN (0, 1, 2)),
    CONSTRAINT chk_asset_class CHECK (asset_class IN ('SATELLITE', 'STATION', 'DRONE', 'COMMAND_CENTER')),
    CONSTRAINT chk_func_type CHECK (func_type IN ('RECON', 'COMM', 'RELAY', 'OTHER')),
    CONSTRAINT chk_usage_type CHECK (usage_type IN ('MILITARY', 'CIVIL_COMMERCIAL')),
    CONSTRAINT chk_asset_lat CHECK (lat IS NULL OR (lat >= -90.0 AND lat <= 90.0)),
    CONSTRAINT chk_asset_lng CHECK (lng IS NULL OR (lng >= -180.0 AND lng <= 180.0)),
    CONSTRAINT chk_anti_jam CHECK (anti_jam_level BETWEEN 0 AND 100),
    CONSTRAINT chk_priority CHECK (base_priority BETWEEN 0 AND 100),
    CONSTRAINT chk_is_detected CHECK (is_detected_by_red IN (0, 1))
);

-- 3. weapons (红方多域战打击体系表)
CREATE TABLE IF NOT EXISTS weapons (
    id TEXT PRIMARY KEY NOT NULL,                                           -- 武器/阵地 UUID
    name TEXT NOT NULL,                                                     -- 武器名称
    category TEXT NOT NULL,                                                 -- 跨域杀伤机理分类: 'EW' (电磁频谱战), 'CYBER' (网络空间战), 'KINETIC' (动能常规打击), 'DEW' (定向能武器)
    kill_type TEXT NOT NULL,                                                -- 毁伤性质: 'SOFT' (软杀伤干扰), 'HARD' (硬物理摧毁)
    base_lat REAL NOT NULL,                                                 -- 武器阵地/发射基地的部署纬度
    base_lng REAL NOT NULL,                                                 -- 武器阵地/发射基地的部署经度
    max_range REAL NOT NULL,                                                -- 有效物理打击或电磁干扰半径 (km, 网络武器设为 -1 表示无距离限制)
    inventory INTEGER DEFAULT -1 NOT NULL,                                  -- 弹药库存数量 (-1 表示无限开火权)
    action_cost REAL NOT NULL,                                              -- 单次开机或弹药发射的经济成本
    political_risk REAL DEFAULT 0.1 NOT NULL,                               -- 冲突升级红线危险系数 (0.1~1.0, 默认 0.1)

    CONSTRAINT chk_weapon_category CHECK (category IN ('EW', 'CYBER', 'KINETIC', 'DEW')),
    CONSTRAINT chk_weapon_kill_type CHECK (kill_type IN ('SOFT', 'HARD')),
    CONSTRAINT chk_weapon_lat CHECK (base_lat >= -90.0 AND base_lat <= 90.0),
    CONSTRAINT chk_weapon_lng CHECK (base_lng >= -180.0 AND base_lng <= 180.0),
    CONSTRAINT chk_political_risk CHECK (political_risk >= 0.0 AND political_risk <= 1.0)
);

-- 4. communication_windows (蓝方信息传输链路与窗口预测表)
CREATE TABLE IF NOT EXISTS communication_windows (
    id TEXT PRIMARY KEY NOT NULL,                                           -- 传输连线唯一 UUID
    scenario_id TEXT NOT NULL,                                              -- 关联场景场景 ID
    source_id TEXT NOT NULL,                                                -- 起点资产 ID (assets)
    target_id TEXT NOT NULL,                                                -- 终点资产 ID (assets)
    window_start INTEGER NOT NULL,                                          -- 链路建立开始时间戳 (AOS 开始 Unix Timestamp)
    window_end INTEGER NOT NULL,                                            -- 链路跌破掩蔽角结束时间戳 (LOS 结束 Unix Timestamp)
    routing_converge_delay INTEGER DEFAULT 30 NOT NULL,                     -- 路由收敛延迟时间 (秒, 遭受打击后自愈路由收敛时间)
    link_status TEXT DEFAULT 'PENDING' NOT NULL,                            -- 实时连线状态: 'PENDING' (等待过境), 'TRANSMITTING' (正常), 'JAMMED' (受干扰), 'DESTROYED' (已摧毁)

    CONSTRAINT fk_comm_scenario FOREIGN KEY (scenario_id) REFERENCES scenarios(id) ON DELETE CASCADE,
    CONSTRAINT fk_comm_source FOREIGN KEY (source_id) REFERENCES assets(id) ON DELETE CASCADE,
    CONSTRAINT fk_comm_target FOREIGN KEY (target_id) REFERENCES assets(id) ON DELETE CASCADE,
    CONSTRAINT chk_window_time CHECK (window_start < window_end),
    CONSTRAINT chk_link_status CHECK (link_status IN ('PENDING', 'TRANSMITTING', 'JAMMED', 'DESTROYED'))
);

-- Create indexes for communication windows to optimize visualization and graph queries
CREATE INDEX IF NOT EXISTS idx_comm_scenario ON communication_windows(scenario_id);
CREATE INDEX IF NOT EXISTS idx_comm_source ON communication_windows(source_id);
CREATE INDEX IF NOT EXISTS idx_comm_target ON communication_windows(target_id);

-- 5. tactical_plans (红方推演方案与运筹总表)
CREATE TABLE IF NOT EXISTS tactical_plans (
    id TEXT PRIMARY KEY NOT NULL,                                           -- 方案唯一 UUID
    scenario_id TEXT NOT NULL,                                              -- 关联战役场景 ID
    name TEXT NOT NULL,                                                     -- 方案名称
    intensity_level TEXT NOT NULL,                                          -- 预设冲突烈度等级: 'LOW' (仅软干扰), 'MEDIUM' (干扰+局部摧毁), 'HIGH' (绝对饱和物理消灭)
    total_cost REAL DEFAULT 0.0 NOT NULL,                                   -- 方案产生累计经济总代价
    total_delay_achieved INTEGER DEFAULT 0 NOT NULL,                        -- 方案累计造成的传输时效性剥夺总延迟 (秒)
    nodes_destroyed INTEGER DEFAULT 0 NOT NULL,                             -- 方案中被物理摧毁的关键节点数量
    final_score REAL DEFAULT 0.0 NOT NULL,                                  -- 方案总效能评估得分 (0-100)

    CONSTRAINT fk_plan_scenario FOREIGN KEY (scenario_id) REFERENCES scenarios(id) ON DELETE CASCADE,
    CONSTRAINT chk_intensity_level CHECK (intensity_level IN ('LOW', 'MEDIUM', 'HIGH')),
    CONSTRAINT chk_final_score CHECK (final_score >= 0.0)
);

-- Create indexes for tactical plans
CREATE INDEX IF NOT EXISTS idx_plan_scenario ON tactical_plans(scenario_id);

-- 6. engagements (交战动作与多维动态衰减判定表)
CREATE TABLE IF NOT EXISTS engagements (
    id TEXT PRIMARY KEY NOT NULL,                                           -- 交战动作唯一 UUID
    plan_id TEXT NOT NULL,                                                  -- 所属对抗方案 ID
    weapon_id TEXT NOT NULL,                                                -- 调用的红方武器 ID
    target_window_id TEXT NOT NULL,                                         -- 被拦截的蓝方通信窗口/链路 ID
    action_time INTEGER NOT NULL,                                           -- 模拟发射或开机的精确时间戳 (Unix Timestamp)
    attenuation_dist REAL NOT NULL,                                         -- 基于平方反比定律计算出的距离衰减乘数
    attenuation_terrain REAL NOT NULL,                                      -- 地面接收站视距地形阻尼衰减乘数
    attenuation_alt REAL NOT NULL,                                          -- 卫星实时高程的自由空间损耗乘数
    attenuation_vel REAL NOT NULL,                                          -- 卫星高速移动的多普勒频移及追随干扰时间差乘数
    attenuation_att REAL NOT NULL,                                          -- 卫星天线极化折损乘数 (指向姿态与倾角不对齐)
    final_js_ratio REAL NOT NULL,                                           -- 综合上述 5 种空间物理衰减因子后计算的最终干信比 (J/S Ratio)
    is_successful INTEGER NOT NULL,                                         -- 0-拦截失败, 1-拦截成功 (低于/高于蓝方解扩门槛)

    CONSTRAINT fk_engage_plan FOREIGN KEY (plan_id) REFERENCES tactical_plans(id) ON DELETE CASCADE,
    CONSTRAINT fk_engage_weapon FOREIGN KEY (weapon_id) REFERENCES weapons(id) ON DELETE CASCADE,
    CONSTRAINT fk_engage_window FOREIGN KEY (target_window_id) REFERENCES communication_windows(id) ON DELETE CASCADE,
    CONSTRAINT chk_engage_success CHECK (is_successful IN (0, 1))
);

-- Create indexes for engagements to speed up calculation queries
CREATE INDEX IF NOT EXISTS idx_engage_plan ON engagements(plan_id);
CREATE INDEX IF NOT EXISTS idx_engage_weapon ON engagements(weapon_id);
CREATE INDEX IF NOT EXISTS idx_engage_window ON engagements(target_window_id);
