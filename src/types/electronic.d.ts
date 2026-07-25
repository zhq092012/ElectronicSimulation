/**
 * 红蓝电磁对抗兵棋推演平台 (单机验证版 V1.0)
 * TS 类型声明 (与 SQLite 数据库表字段 1:1 映射)
 */

/**
 * 阵营字面量联合类型
 */
export type Side = 'RED' | 'BLUE';

/**
 * 立体战场空间分层
 * 0: 地基层 (Ground Layer)
 * 1: 空基层 (Air Layer)
 * 2: 天基层 (Space/Satellite Layer)
 */
export type BattlefieldLayer = 0 | 1 | 2;

/**
 * 物理形态分类
 * 'SATELLITE':'卫星'
 * 'STATION':'地面站'
 * 'DRONE':'无人机'
 * 'COMMAND_CENTER':'指挥中心'
 */
export type AssetClass = 'SATELLITE' | 'STATION' | 'DRONE' | 'COMMAND_CENTER';

/**
 * 核心功能分类
 * 'RECON':'侦察卫星' 
 * 'COMM':'通信卫星' 
 * 'RELAY':'中继卫星' 
 * 'OTHER':'其他' 
 */
export type FuncType = 'RECON' | 'COMM' | 'RELAY' | 'OTHER';

/**
 * 所有权用途分类
 * 'MILITARY':'军事'
 * 'CIVIL_COMMERCIAL':'民用商业'
 */
export type UsageType = 'MILITARY' | 'CIVIL_COMMERCIAL';

/**
 * 跨域杀伤机理分类
 * 'EW':'电子战'
 * 'CYBER':'网络战'
 * 'KINETIC':'物理战'
 * 'DEW':'定向能武器'
 */
export type WeaponCategory = 'EW' | 'CYBER' | 'KINETIC' | 'DEW';

/**
 * 毁伤性质分类
 * 'SOFT':'软杀伤'
 * 'HARD':'硬杀伤' 
 */
export type KillType = 'SOFT' | 'HARD';

/**
 * 链路及通讯窗口实时连线状态
 * 'PENDING':'未建立'
 * 'TRANSMITTING':'通信中'
 * 'JAMMED':'被干扰'
 * 'DESTROYED':'被摧毁'
 */
export type LinkStatus = 'PENDING' | 'TRANSMITTING' | 'JAMMED' | 'DESTROYED' | 'ENGAGEMENT';

/**
 * 推演方案预设冲突严重烈度等级
 * 'LOW':'低烈度'
 * 'MEDIUM':'中烈度'
 * 'HIGH':'高烈度'
 */
export type IntensityLevel = 'LOW' | 'MEDIUM' | 'HIGH';

/**
 * 战役场景配置与全局约束表
 */
export interface Scenario {
  id: string;                    // 场景唯一 UUID
  name: string;                  // 场景名称
  min_lat: number;               // 战区视口边界纬度下限
  max_lat: number;               // 战区视口边界纬度上限
  min_lng: number;               // 战区视口边界经度下限
  max_lng: number;               // 战区视口边界经度上限
  start_time: number;            // 推演演练开始时间戳 (Unix Timestamp, 秒)
  end_time: number;              // 推演演练结束时间戳 (Unix Timestamp, 秒)
  max_budget: number | null;     // 红方允许的最大压制战术资源/资金上限 (null 代表无限制)
  time_step_seconds: number;     // 仿真时钟步长，默认每步进1个Tick代表1分钟（60秒）
}

/**
 * 2. assets (空天地立体战场实体资产表)
 */
export interface Asset {
  id: string;                     // 资产唯一 UUID
  side: Side;                     // 阵营: RED / BLUE
  layer: BattlefieldLayer;        // 立体分层: 0, 1, 2
  asset_class: AssetClass;        // 物理形态分类: SATELLITE / STATION / DRONE / COMMAND_CENTER
  func_type: FuncType;            // 核心功能分类: RECON / COMM / RELAY / OTHER
  usage_type: UsageType;          // 所有权用途: MILITARY / CIVIL_COMMERCIAL
  lat: number | null;             // 地面站或低空资产纬度坐标 (度)
  lng: number | null;             // 地面站或低空资产经度坐标 (度)
  alt: number | null;             // 高度/海拔/轨道高度 (单位: km. 地面站默认0)
  tle_data: string | null;        // 卫星专属：标准的双行轨道根数 (TLE, 用于 SGP4 算法进行位置外推)
  terrain_mask_angle: number;     // 地面站专属物理门槛：地平线最低仰角掩蔽角 (度, 默认 10.0)
  anti_jam_level: number;         // 接收机抗干扰基准等级 (1-100, 默认 50)
  base_priority: number;          // 基础目标价值分 (0-100, 默认 50)
  is_detected_by_red: 0 | 1;      // 战争迷雾：0-隐蔽未发现，1-已被红方电子侦察发现 (仅 1 才能被武器打击)
}

/**
 * 3. weapons (红方多域战打击体系表)
 */
export interface Weapon {
  id: string;               // 武器/阵地 UUID
  name: string;             // 武器名称
  category: WeaponCategory; // 跨域杀伤机理分类
  kill_type: KillType;      // 毁伤性质: 软杀伤/硬物理摧毁
  base_lat: number;         // 武器阵地纬度坐标 (度)
  base_lng: number;         // 武器阵地经度坐标 (度)
  max_range: number;        // 有效物理打击或电磁干扰半径 (km, 网络空间武器设为 -1 代表无距离限制)
  inventory: number;        // 弹药库存数量 (-1 表示无限开火权)
  action_cost: number;      // 单次开机或弹药发射的经济成本
  political_risk: number;   // 冲突升级红线危险系数 (0.1 ~ 1.0, 默认 0.1)
}

/**
 * 4. communication_windows (蓝方信息传输链路与窗口预测表)
 */
export interface CommunicationWindow {
  id: string;                     // 传输连线唯一 UUID
  scenario_id: string;            // 外键：关联战役场景 ID
  source_id: string;              // 外键：关联起点资产 ID (assets)
  target_id: string;              // 外键：关联终点资产 ID (assets)
  window_start: number;           // 链路因过境仰角超过最低掩蔽角而建立的时刻 (Unix Timestamp, 秒)
  window_end: number;             // 链路因跌破掩蔽角或落入地平线而断开的时刻 (Unix Timestamp, 秒)
  routing_converge_delay: number; // 链路遭受打击后，网络协议自愈重新寻找备用路由的收敛延迟时间 (秒, 默认 30)
  link_status: LinkStatus;        // 实时连线状态: PENDING / TRANSMITTING / JAMMED / DESTROYED
}

/**
 * 5. tactical_plans (红方推演方案与运筹总表)
 */
export interface TacticalPlan {
  id: string;                     // 方案唯一 UUID
  scenario_id: string;            // 外键：关联战役场景 ID
  name: string;                  // 方案名称
  intensity_level: IntensityLevel;// 预设冲突严重烈度等级
  total_cost: number;             // 该方案累计产生的开机/弹药发射经济总代价
  total_delay_achieved: number;   // 该方案在 50 分钟内累计为蓝方造成的传输时效性剥夺总延迟 (秒)
  nodes_destroyed: number;        // 方案中被物理摧毁的关键节点数量
  final_score: number;            // 方案总效能加权得分 (100 分制)
}

/**
 * 6. engagements (交战动作与多维动态衰减判定表)
 */
export interface Engagement {
  id: string;                     // 交战动作唯一 UUID
  plan_id: string;                // 外键：关联所属对抗方案 ID
  weapon_id: string;              // 外键：关联调用的红方武器 ID
  target_window_id: string;       // 外键：关联被拦截的蓝方通信窗口/链路 ID
  action_time: number;            // 模拟发射或开机的精确时间戳 (Unix Timestamp, 秒)
  attenuation_dist: number;       // 基于平方反比定律计算出的距离衰减乘数
  attenuation_terrain: number;    // 地面接收站视距被地形/建筑挡住的阻尼衰减乘数
  attenuation_alt: number;        // 基于卫星实时高程的自由空间损耗乘数
  attenuation_vel: number;        // 卫星高速移动引发的多普勒频移及追随干扰时间差乘数
  attenuation_att: number;        // 卫星天线当前指向姿态与倾角不对齐带来的极化折损乘数
  final_js_ratio: number;         // 综合上述 5 种空间物理衰减因子后，计算出的最终有效干信比 (J/S Ratio)
  is_successful: 0 | 1;           // 0-拦截失败，1-拦截成功 (高于或低于蓝方抗干扰解扩门槛)
}

/**
 * 时间窗口结构体
 */
export interface TimeWindow {
  window_start: number;
  window_end: number;
}

/**
 * 7. 算法矩阵——1. 空间卫星过境矩阵项
 */
export interface PassMatrixItem {
  sat_id: string;
  sat_name: string;
  windows: TimeWindow[];
}

/**
 * 7. 算法矩阵——2. 星地通视矩阵项
 */
export interface VisibleMatrixItem {
  source_id: string;
  source_name: string;
  target_id: string;
  target_name: string;
  windows: TimeWindow[];
}

/**
 * 7. 算法矩阵——3. 传输时延开销 Tick 明细
 */
export interface OverheadMatrixTick {
  time: number;
  tick_min: number;
  status: LinkStatus | string;
  trans_delay: number;
  proc_delay: number;
  extra_delay: number;
  total_overhead: number;
}

/**
 * 7. 算法矩阵——3. 传输时延开销压缩时间段
 */
export interface OverheadMatrixSegment {
  start_min: number;
  end_min: number;
  status: LinkStatus | string;
  trans_delay: number;
  proc_delay: number;
  extra_delay: number;
  total_overhead: number;
}

/**
 * 7. 算法矩阵——3. 传输时延矩阵项
 */
export interface OverheadMatrixItem {
  source_id: string;
  source_name: string;
  source_layer: BattlefieldLayer;
  target_id: string;
  target_name: string;
  target_layer: BattlefieldLayer;
  link_type: 'SAT_TO_STATION' | 'STATION_TO_CMD';
  trans_delay: number;
  proc_delay: number;
  extra_delay: number;
  total_overhead: number;
  link_status: LinkStatus;
  avg_overhead: number;
  max_overhead: number;
  min_overhead: number;
  ticks: OverheadMatrixTick[];
  segments: OverheadMatrixSegment[];
}

/**
 * 7. 算法矩阵——4. 武器打击矩阵项
 */
export interface AttackMatrixItem {
  weapon_id: string;
  weapon_name: string;
  category: WeaponCategory;
  kill_type: KillType;
  target_id: string;
  target_name: string;
  target_layer: BattlefieldLayer;
  theoretical_delay: number;
  actual_delay: number;
  is_executed: boolean;
  action_cost: number;
  windows: TimeWindow[];
}

/**
 * 四大全域战术算法矩阵集合
 */
export interface TacticalMatrices {
  passMatrix: PassMatrixItem[];
  visibleMatrix: VisibleMatrixItem[];
  overheadMatrix: OverheadMatrixItem[];
  attackMatrix: AttackMatrixItem[];
}

/**
 * 3D 拓扑图节点类型
 */
export interface GraphNode extends Partial<Asset> {
  id: string;
  name?: string;
  x?: number;
  y?: number;
  z?: number;
  vx?: number;
  vy?: number;
  vz?: number;
  fx?: number | null;
  fy?: number | null;
  fz?: number | null;
  __threeObj?: unknown;
}

/**
 * 3D 拓扑图连线类型
 */
export interface GraphLink {
  id: string;
  source: string | GraphNode;
  target: string | GraphNode;
  window_start: number;
  window_end: number;
  routing_converge_delay: number;
  link_status: LinkStatus;
  scenario_id?: string;
  source_id?: string;
  target_id?: string;
}

/**
 * 武器智能打击分配矩阵行
 */
export interface WeaponAssignmentRow {
  weapon_id: string;
  weapon_name: string;
  weapon_category: WeaponCategory;
  kill_type: KillType;
  action_cost: number;
  max_range: number;
  window_id: string;
  target_source_id: string;
  target_dest_id: string;
  window_start: number;
  window_end: number;
  theoretical_delay: number;
  cost_benefit_ratio: number;
  recommended: boolean;
}

