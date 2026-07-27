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
 * 'ENGAGEMENT':'最短时效链路'
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
  window_start: number; //时间窗口开始时间
  window_end: number; //时间窗口结束时间
}

/**
 * 7. 算法矩阵——1. 空间卫星过境矩阵项
 */
export interface PassMatrixItem {
  sat_id: string; //卫星ID
  sat_name: string; //卫星名称
  windows: TimeWindow[]; //时间窗口
}

/**
 * 7. 算法矩阵——2. 星地通视矩阵项
 */
export interface VisibleMatrixItem {
  source_id: string; //起点ID
  source_name: string; //起点名称
  target_id: string; //终点ID
  target_name: string; //终点名称
  windows: TimeWindow[]; //时间窗口
}

/**
 * 7. 算法矩阵——3. 传输时延开销 Tick 明细
 */
export interface OverheadMatrixTick {
  time: number; //信号开始传输时刻（秒）
  tick_min: number; //分钟数
  status: LinkStatus | string; //链路状态
  trans_delay: number; //传输延迟（秒）
  proc_delay: number; //处理延迟（秒）
  extra_delay: number; //额外延迟（秒）
  total_overhead: number; //总开销（秒）
}

/**
 * 7. 算法矩阵——3. 传输时延开销压缩时间段
 */
export interface OverheadMatrixSegment {
  start_min: number; //开始时间（分钟）
  end_min: number; //结束时间（分钟）
  status: LinkStatus | string; //链路状态
  trans_delay: number; //传输延迟（秒）
  proc_delay: number; //处理延迟（秒）
  extra_delay: number; //额外延迟（秒）
  total_overhead: number; //总开销（秒）
}

/**
 * 7. 算法矩阵——3. 传输时延矩阵项
 */
export interface OverheadMatrixItem {
  source_id: string; //起点资产ID
  source_name: string; //起点资产名称
  source_layer: BattlefieldLayer; //起点资产所处兵力层级
  target_id: string; //终点资产ID
  target_name: string; //终点资产名称
  target_layer: BattlefieldLayer; //终点资产所处兵力层级
  link_type: 'SAT_TO_STATION' | 'STATION_TO_CMD'; //链路类型（卫星到地面/地面到指挥中心）
  trans_delay: number; //传输延迟（秒）
  proc_delay: number; //处理延迟（秒）
  extra_delay: number; //额外延迟（秒）
  total_overhead: number; //总开销（秒）
  link_status: LinkStatus; //链路状态
  avg_overhead: number;  //平均开销（秒）
  max_overhead: number; //最大开销（秒）
  min_overhead: number; //最小开销（秒）
  ticks: OverheadMatrixTick[]; //时延开销明细
  segments: OverheadMatrixSegment[]; //时延开销压缩时间段
}

/**
 * 7. 算法矩阵——4. 武器打击矩阵项
 */
export interface AttackMatrixItem {
  weapon_id: string; //武器ID
  weapon_name: string; //武器名称
  category: WeaponCategory; //武器分类
  kill_type: KillType; //毁伤性质
  target_id: string; //目标ID
  target_name: string; //目标名称
  target_layer: BattlefieldLayer; //目标所处兵力层级
  theoretical_delay: number; //理论延迟（秒）
  actual_delay: number; //实际延迟（秒）
  is_executed: boolean; //是否执行
  action_cost: number; //动作代价
  windows: TimeWindow[]; //时间窗口
}

/**
 * 全链路传输过程中受到影响的武器打击归因项
 */
export interface FullChainAttribution {
  /** 打击发生的精确时间戳 (Unix Timestamp, 秒) */
  time: number;

  /** 相对推演开始时间的分钟数 (T+X min) */
  minute: number;

  /** 红方武器唯一标识 ID */
  weapon_id: string;

  /** 红方武器名称 */
  weapon_name: string;

  /** 武器跨域杀伤分类 */
  category: WeaponCategory;

  /** 毁伤性质: 软杀伤/硬物理摧毁 */
  kill_type: KillType;

  /** 受到打击影响的蓝方目标节点 ID */
  target_id: string;

  /** 受到打击影响的蓝方目标节点名称 */
  target_name: string;

  /** 该武器打击动作对本次全链路传输造成的延时开销贡献 (秒) */
  delay_impact: number;
}

/**
 * 蓝方最早完成一次全链路传输分析结果结构体
 */
export interface EarliestFullChainAnalysis {
  /** 蓝方最佳全链路信号发射发起时刻 (Unix Timestamp, 秒) */
  optimalStartTime: number;

  /** 蓝方最佳全链路信号发射发起时刻相对推演分钟数 (T+X min) */
  optimalStartMin: number;

  /** 受到对抗打压后，实际最早完成全链路接收的时刻 (Unix Timestamp, 秒) */
  earliestFinishTime: number;

  /** 实际最早完成全链路接收的相对推演分钟数 (T+Y min) */
  earliestFinishMin: number;

  /** 在无武器攻击的未受影响基准情况下，最早完成全链路接收的时刻 (Unix Timestamp, 秒) */
  baselineFinishTime: number;

  /** 未受影响基准情况下的相对推演分钟数 (T+Z min) */
  baselineFinishMin: number;

  /** 未受影响基准下的全链路总开销耗时 (秒) */
  totalBaselineOverhead: number;

  /** 受到对抗打压后的全链路实际总耗时 (秒) */
  actualDelay: number;

  /** 受武器影响而增加的时间差额：Delay_Delta = actualDelay - totalBaselineOverhead (秒) */
  delayDelta: number;

  /** 构成该最早全链路的完整节点路径序列 (例: [Sat_ID, Station_ID, Cmd_ID]) */
  pathNodes: string[];

  /** 构成该最早全链路的节点名称序列 */
  pathNodeNames: string[];

  /** 构成该最早全链路的单跳链路连线对 ID 标识列表 */
  pathLinkIds: string[];

  /** 在全链路传输过程中受红方武器打击影响的时间点与延时归因列表 */
  attributions: FullChainAttribution[];
}

/**
 * 四大全域战术算法矩阵集合
 */
export interface TacticalMatrices {
  passMatrix: PassMatrixItem[]; //卫星过境矩阵
  visibleMatrix: VisibleMatrixItem[]; //星地通视矩阵
  overheadMatrix: OverheadMatrixItem[]; //传输时延开销矩阵
  attackMatrix: AttackMatrixItem[]; //武器打击矩阵

  /** 蓝方最早完成一次全链路传输分析解算结果 */
  earliestFullChain?: EarliestFullChainAnalysis;
}

/**
 * 3D 拓扑图节点类型
 */
export interface GraphNode extends Partial<Asset> {
  id: string; //节点ID
  name?: string; //节点名称
  x?: number; //X轴坐标
  y?: number; //Y轴坐标
  z?: number; //Z轴坐标
  vx?: number; //X轴速度
  vy?: number; //Y轴速度
  vz?: number; //Z轴速度
  fx?: number | null; //X轴力
  fy?: number | null; //Y轴力
  fz?: number | null; //Z轴力
  __threeObj?: unknown; //三维对象
}

/**
 * 3D 拓扑图连线类型
 */
export interface GraphLink {
  id: string; //连线ID
  source: string | GraphNode; //源节点
  target: string | GraphNode; //目标节点
  window_start: number; //时间窗口开始时间
  window_end: number; //时间窗口结束时间
  routing_converge_delay: number; //路由收敛延迟
  link_status: LinkStatus; //链路状态
  scenario_id?: string; //场景ID
  source_id?: string; //源节点ID
  target_id?: string; //目标节点ID
}

/**
 * 武器智能打击分配矩阵行
 */
export interface WeaponAssignmentRow {
  weapon_id: string; //武器ID
  weapon_name: string; //武器名称
  weapon_category: WeaponCategory; //武器分类
  kill_type: KillType; //毁伤性质
  action_cost: number; //动作代价
  max_range: number; //最大射程
  window_id: string; //时间窗口ID
  target_source_id: string; //目标源ID
  target_dest_id: string; //目标终点ID
  window_start: number; //时间窗口开始时间
  window_end: number; //时间窗口结束时间
  theoretical_delay: number; //理论延迟（秒）
  cost_benefit_ratio: number;  //性价比
  recommended: boolean; //是否推荐
}

