<template>
  <div class="tactical-matrix-view">
    <!-- Console Toolbar -->
    <div class="matrix-toolbar tech-panel">
      <div class="toolbar-header">
        <div class="toolbar-title">
          <span class="title-icon">🧮</span>
          <span class="title-text glow-text-cyan">全域多域战术算法矩阵</span>
          <span class="scenario-tag">SCENARIO: scen-001</span>
        </div>
        <div class="toolbar-actions">
          <div class="search-box">
            <input 
              v-model="searchQuery" 
              type="text" 
              placeholder="搜索节点 ID / 武器 / 卫星..." 
              class="tech-input"
            />
          </div>
          <button class="tech-btn btn-cyan" :disabled="loading" @click="handleRefresh">
            <span :class="{ 'spin-icon': loading }">🔄</span>
            <span>{{ loading ? '矩阵解算中...' : '重新解算矩阵' }}</span>
          </button>
        </div>
      </div>
    </div>

    <!-- KPI Metric Summary Cards -->
    <div class="kpi-cards-row">
      <!-- Card 1: Pass Satellites -->
      <div class="kpi-card tech-panel bg-gradient-cyan">
        <div class="card-icon">📡</div>
        <div class="card-content">
          <div class="card-label">空间天基过境卫星</div>
          <div class="card-value-group">
            <span class="digital-font card-value text-cyan">{{ passMatrixStats.satCount }}</span>
            <span class="card-unit">颗</span>
            <span class="card-sub-val">({{ passMatrixStats.totalWindows }} 个过境窗口)</span>
          </div>
        </div>
      </div>

      <!-- Card 2: Sight Links -->
      <div class="kpi-card tech-panel bg-gradient-blue">
        <div class="card-icon">👁️</div>
        <div class="card-content">
          <div class="card-label">星地通视链路对</div>
          <div class="card-value-group">
            <span class="digital-font card-value text-cyan">{{ visibleMatrixStats.pairCount }}</span>
            <span class="card-unit">对</span>
            <span class="card-sub-val">({{ visibleMatrixStats.totalWindows }} 视算时间窗)</span>
          </div>
        </div>
      </div>

      <!-- Card 3: Avg Overhead -->
      <div class="kpi-card tech-panel bg-gradient-yellow">
        <div class="card-icon">⏱️</div>
        <div class="card-content">
          <div class="card-label">全域传输时延均值</div>
          <div class="card-value-group">
            <span class="digital-font card-value text-yellow">{{ overheadMatrixStats.avgOverhead }}</span>
            <span class="card-unit">秒</span>
            <span class="card-sub-val">(峰值 {{ overheadMatrixStats.maxOverhead }}s)</span>
          </div>
        </div>
      </div>

      <!-- Card 4: Strike Windows -->
      <div class="kpi-card tech-panel bg-gradient-red">
        <div class="card-icon">🎯</div>
        <div class="card-content">
          <div class="card-label">武器有效打击对</div>
          <div class="card-value-group">
            <span class="digital-font card-value text-red">{{ attackMatrixStats.targetCount }}</span>
            <span class="card-unit">组</span>
            <span class="card-sub-val">({{ attackMatrixStats.executedCount }} 组已执行开火)</span>
          </div>
        </div>
      </div>
    </div>

    <!-- Matrix Sub-Tabs Navigation -->
    <div class="matrix-nav-row tech-panel">
      <div class="matrix-tabs">
        <button 
          class="matrix-tab-btn" 
          :class="{ active: activeSubTab === 'PASS' }" 
          @click="activeSubTab = 'PASS'"
        >
          <span>📡 1. 空间过境矩阵</span>
          <span class="badge-count">{{ filteredPassMatrix.length }}</span>
        </button>
        <button 
          class="matrix-tab-btn" 
          :class="{ active: activeSubTab === 'VISIBILITY' }" 
          @click="activeSubTab = 'VISIBILITY'"
        >
          <span>👁️ 2. 星地通视矩阵</span>
          <span class="badge-count">{{ filteredVisibleMatrix.length }}</span>
        </button>
        <button 
          class="matrix-tab-btn" 
          :class="{ active: activeSubTab === 'OVERHEAD' }" 
          @click="activeSubTab = 'OVERHEAD'"
        >
          <span>⏱️ 3. 传输时延矩阵</span>
          <span class="badge-count">{{ filteredOverheadMatrix.length }}</span>
        </button>
        <button 
          class="matrix-tab-btn" 
          :class="{ active: activeSubTab === 'ATTACK' }" 
          @click="activeSubTab = 'ATTACK'"
        >
          <span>🎯 4. 武器打击矩阵</span>
          <span class="badge-count">{{ filteredAttackMatrix.length }}</span>
        </button>
        <button 
          class="matrix-tab-btn highlight-gold-btn" 
          :class="{ active: activeSubTab === 'FULLCHAIN' }" 
          @click="activeSubTab = 'FULLCHAIN'"
        >
          <span>⚡ 5. 最早全链路传输解算</span>
          <span v-if="matrices && matrices.earliestFullChain" class="badge-count text-gold">T+{{ matrices.earliestFullChain.earliestFinishMin }}m</span>
        </button>
      </div>
    </div>

    <!-- Loading State -->
    <div v-if="loading" class="matrix-loading-state tech-panel">
      <div class="loading-spinner"></div>
      <div class="loading-text digital-font glow-text-cyan">Worker 正在高速解算 SGP4 轨道与多域算法矩阵...</div>
    </div>

    <!-- Empty State -->
    <div v-else-if="isEmpty" class="matrix-empty-state tech-panel">
      <span class="empty-icon">📂</span>
      <div class="empty-text">暂无算法矩阵解算结果，请点击“重新解算矩阵”获取最新推演矩阵。</div>
    </div>

    <!-- Tab Contents -->
    <div v-else class="matrix-content-container">
      <!-- 1. Pass Matrix Tab -->
      <div v-if="activeSubTab === 'PASS'" class="tab-pane tech-panel">
        <div class="pane-header">
          <div class="pane-title">空间卫星过境战区时间序列矩阵 (Pass Matrix)</div>
          <div class="pane-desc">解算高轨/低轨卫星空间轨迹落在战区经纬度覆盖框内的有效视角时间窗</div>
        </div>
        <div class="table-wrapper">
          <table class="tech-table">
            <thead>
              <tr>
                <th>卫星编号 / ID</th>
                <th>立体分层</th>
                <th>过境次数</th>
                <th>战区过境时间窗口序列 (Unix Stamp & 相对分钟)</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="item in filteredPassMatrix" :key="item.sat_id">
                <td class="sat-name">
                  <span class="sat-icon">🛰️</span>
                  <span class="bold-text text-cyan">{{ item.sat_name || item.sat_id }}</span>
                </td>
                <td>
                  <span class="tag-pill tag-space">Layer 2 (天基层)</span>
                </td>
                <td class="digital-font font-large">{{ item.windows ? item.windows.length : 0 }} 次</td>
                <td>
                  <div v-if="item.windows && item.windows.length > 0" class="window-pill-list">
                    <div 
                      v-for="(w, idx) in item.windows" 
                      :key="idx" 
                      class="window-pill"
                    >
                      <span class="pill-label">窗口 {{ Number(idx) + 1 }}:</span>
                      <span class="digital-font time-span">
                        {{ formatTime(w.window_start) }} ~ {{ formatTime(w.window_end) }}
                      </span>
                      <span class="duration-badge">
                        ({{ Math.round((w.window_end - w.window_start) / 60) }} min)
                      </span>
                    </div>
                  </div>
                  <span v-else class="text-dim">推演时间内无直射过境</span>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <!-- 2. Visibility Matrix Tab -->
      <div v-if="activeSubTab === 'VISIBILITY'" class="tab-pane tech-panel">
        <div class="pane-header">
          <div class="pane-title">星地通视时间窗口序列矩阵 (Visible Matrix)</div>
          <div class="pane-desc">根据 SGP4 矢量传播与地面掩蔽角解算低轨卫星 (Layer 2) 与地面接收站 (Layer 1) 的实时可通视视角</div>
        </div>
        <div class="table-wrapper">
          <table class="tech-table">
            <thead>
              <tr>
                <th>源节点 (Layer 2 卫星)</th>
                <th>目标节点 (Layer 1 接收站)</th>
                <th>通视窗口总数</th>
                <th>星地物理通视微观时间段</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="(item, idx) in filteredVisibleMatrix" :key="idx">
                <td>
                  <span class="node-badge node-blue">🛰️ {{ item.source_name || item.source_id }}</span>
                </td>
                <td>
                  <span class="node-badge node-green">📡 {{ item.target_name || item.target_id }}</span>
                </td>
                <td class="digital-font font-large text-cyan">
                  {{ item.windows ? item.windows.length : 0 }} 窗
                </td>
                <td>
                  <div class="window-pill-list">
                    <div 
                      v-for="(w, wIdx) in item.windows" 
                      :key="wIdx" 
                      class="window-pill pill-cyan"
                    >
                      <span class="pill-label">窗 {{ Number(wIdx) + 1 }}:</span>
                      <span class="digital-font time-span">
                        {{ formatTime(w.window_start) }} → {{ formatTime(w.window_end) }}
                      </span>
                      <span class="duration-badge">
                        ({{ Math.round(w.window_end - w.window_start) }}s)
                      </span>
                    </div>
                  </div>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <!-- 3. Overhead Matrix Tab -->
      <div v-if="activeSubTab === 'OVERHEAD'" class="tab-pane tech-panel">
        <div class="pane-header">
          <div class="pane-title">全域链路处理与传输时间开销矩阵 (Overhead Matrix)</div>
          <div class="pane-desc">解算全战区各层骨干网络在各时间 Tick 下的传输延时、星载/站内处理开销以及软硬交战叠加延迟</div>
        </div>
        <div class="table-wrapper">
          <table class="tech-table">
            <thead>
              <tr>
                <th>通信链路对</th>
                <th>链路架构分层</th>
                <th>基础传输</th>
                <th>硬件处理</th>
                <th>交战加成时延</th>
                <th>当前总时延 (s)</th>
                <th>链路状态</th>
                <th>全时序延时极值 (Min/Avg/Max)</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="(item, idx) in filteredOverheadMatrix" :key="idx">
                <td>
                  <div class="link-pair">
                    <span class="node-text">{{ item.source_name || item.source_id }}</span>
                    <span class="arrow-icon">➔</span>
                    <span class="node-text">{{ item.target_name || item.target_id }}</span>
                  </div>
                </td>
                <td>
                  <span v-if="item.link_type === 'SAT_TO_STATION'" class="tag-pill tag-sat-station">
                    Layer 2 ➔ Layer 1 (星地)
                  </span>
                  <span v-else class="tag-pill tag-station-cmd">
                    Layer 1 ➔ Layer 0 (地指)
                  </span>
                </td>
                <td class="digital-font">{{ item.trans_delay }}s</td>
                <td class="digital-font">{{ item.proc_delay }}s</td>
                <td class="digital-font" :class="item.extra_delay > 0 ? 'text-red bold-text' : 'text-dim'">
                  +{{ item.extra_delay }}s
                </td>
                <td class="digital-font font-large" :class="getDelayColorClass(item.total_overhead)">
                  {{ item.total_overhead }}s
                </td>
                <td>
                  <span class="status-badge" :class="getStatusBadgeClass(item.link_status)">
                    {{ getStatusText(item.link_status) }}
                  </span>
                </td>
                <td>
                  <div class="overhead-stats">
                    <span class="stat-item text-green">{{ item.min_overhead }}s</span> /
                    <span class="stat-item text-yellow bold-text">{{ item.avg_overhead }}s</span> /
                    <span class="stat-item text-red">{{ item.max_overhead }}s</span>
                  </div>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <!-- 4. Attack Matrix Tab -->
      <div v-if="activeSubTab === 'ATTACK'" class="tab-pane tech-panel">
        <div class="pane-header">
          <div class="pane-title">武器对全域节点有效打击窗口矩阵 (Attack Matrix)</div>
          <div class="pane-desc">计算红方武器针对蓝方天基、空基及地基节点的射程打击视界、阻断延时加成与实战开火部署情况</div>
        </div>
        <div class="table-wrapper">
          <table class="tech-table">
            <thead>
              <tr>
                <th>武器名称 / 类型</th>
                <th>杀伤毁伤类型</th>
                <th>打击目标资产</th>
                <th>目标层级</th>
                <th>理论造成延时</th>
                <th>实际叠加延时</th>
                <th>行动成本 ($)</th>
                <th>实战状态</th>
                <th>有效打击时间窗口</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="(item, idx) in filteredAttackMatrix" :key="idx">
                <td>
                  <div class="weapon-info">
                    <span class="weapon-icon">{{ getWeaponIcon(item.category) }}</span>
                    <span class="weapon-name bold-text">{{ item.weapon_name || item.weapon_id }}</span>
                    <span class="category-pill">{{ item.category }}</span>
                  </div>
                </td>
                <td>
                  <span class="tag-pill" :class="item.kill_type === 'HARD' ? 'tag-hard' : 'tag-soft'">
                    {{ item.kill_type === 'HARD' ? '硬杀伤 (PHYSICAL)' : '软杀伤 (SUPPRESS)' }}
                  </span>
                </td>
                <td>
                  <span class="node-badge node-blue">{{ item.target_name || item.target_id }}</span>
                </td>
                <td>
                  <span class="tag-pill" :class="getLayerTagClass(item.target_layer)">
                    Layer {{ item.target_layer }}
                  </span>
                </td>
                <td class="digital-font text-yellow">+{{ item.theoretical_delay }}s</td>
                <td class="digital-font font-large" :class="item.actual_delay > 0 ? 'text-red bold-text' : 'text-dim'">
                  +{{ item.actual_delay }}s
                </td>
                <td class="digital-font text-cyan">${{ item.action_cost ? item.action_cost.toLocaleString() : '0' }}</td>
                <td>
                  <span class="status-badge" :class="item.is_executed ? 'status-red' : 'status-green'">
                    {{ item.is_executed ? '💥 已执行开火' : '✅ 窗口有效 (待指令)' }}
                  </span>
                </td>
                <td>
                  <div class="window-pill-list">
                    <div 
                      v-for="(w, wIdx) in item.windows" 
                      :key="wIdx" 
                      class="window-pill pill-red"
                    >
                      <span class="pill-label">窗 {{ Number(wIdx) + 1 }}:</span>
                      <span class="digital-font time-span">
                        {{ formatTime(w.window_start) }} ~ {{ formatTime(w.window_end) }}
                      </span>
                    </div>
                  </div>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <!-- 5. Full Chain Transfer Tab -->
      <div v-if="activeSubTab === 'FULLCHAIN'" class="tab-pane tech-panel">
        <div class="pane-header">
          <div class="pane-title flex-title">
            <span>⚡ 蓝方最早完成一次全链路传输分析与武器影响归因</span>
            <button 
              v-if="matrices && matrices.earliestFullChain" 
              class="tech-btn btn-gold" 
              @click="handleHighlightFullChain"
            >
              ✨ 在 3D 拓扑大屏中高亮显示此链路
            </button>
          </div>
          <div class="pane-desc">解算蓝方全链路 (Layer 2 卫星 ➔ Layer 1 地面站 ➔ Layer 0 指挥中心) 在软硬武器打击压制下的实际最早完成时刻与时间差归因</div>
        </div>

        <div v-if="matrices && matrices.earliestFullChain" class="fullchain-analysis-container">
          <!-- KPI Summary Cards for Full Chain -->
          <div class="kpi-cards-row fullchain-cards">
            <div class="kpi-card tech-panel bg-gradient-cyan">
              <div class="card-icon">🚀</div>
              <div class="card-content">
                <div class="card-label">最佳发射发起时刻</div>
                <div class="card-value-group">
                  <span class="digital-font card-value text-cyan">T+{{ matrices.earliestFullChain.optimalStartMin }}m</span>
                  <span class="card-sub-val">({{ formatTime(matrices.earliestFullChain.optimalStartTime) }})</span>
                </div>
              </div>
            </div>

            <div class="kpi-card tech-panel bg-gradient-blue">
              <div class="card-icon">🏁</div>
              <div class="card-content">
                <div class="card-label">实际最早完成时刻</div>
                <div class="card-value-group">
                  <span class="digital-font card-value text-cyan">T+{{ matrices.earliestFullChain.earliestFinishMin }}m</span>
                  <span class="card-sub-val">({{ formatTime(matrices.earliestFullChain.earliestFinishTime) }})</span>
                </div>
              </div>
            </div>

            <div class="kpi-card tech-panel bg-gradient-yellow">
              <div class="card-icon">📏</div>
              <div class="card-content">
                <div class="card-label">未受影响基准耗时</div>
                <div class="card-value-group">
                  <span class="digital-font card-value text-yellow">{{ matrices.earliestFullChain.totalBaselineOverhead }}</span>
                  <span class="card-unit">秒</span>
                  <span class="card-sub-val">(理论零干扰全链路耗时)</span>
                </div>
              </div>
            </div>

            <div class="kpi-card tech-panel bg-gradient-red">
              <div class="card-icon">⚠️</div>
              <div class="card-content">
                <div class="card-label">受影响增加时间差 (Delay Delta)</div>
                <div class="card-value-group">
                  <span class="digital-font card-value text-red">+{{ matrices.earliestFullChain.delayDelta }}</span>
                  <span class="card-unit">秒</span>
                  <span class="card-sub-val">(实际总耗时 {{ matrices.earliestFullChain.actualDelay }}s)</span>
                </div>
              </div>
            </div>
          </div>

          <!-- Path Topology Flow Display -->
          <div class="path-flow-panel tech-panel">
            <div class="panel-subtitle">节点拓扑传输路径</div>
            <div class="path-steps">
              <div class="path-step-item">
                <span class="step-badge step-sat">Layer 2 天基卫星</span>
                <span class="step-name">{{ matrices.earliestFullChain.pathNodeNames[0] }}</span>
              </div>
              <div class="path-arrow font-large glow-text-cyan">➔ (单跳传输) ➔</div>
              <div class="path-step-item">
                <span class="step-badge step-station">Layer 1 地面接收站</span>
                <span class="step-name">{{ matrices.earliestFullChain.pathNodeNames[1] }}</span>
              </div>
              <div class="path-arrow font-large glow-text-cyan">➔ (骨干通信) ➔</div>
              <div class="path-step-item">
                <span class="step-badge step-cmd">Layer 0 联合指挥中心</span>
                <span class="step-name">{{ matrices.earliestFullChain.pathNodeNames[2] }}</span>
              </div>
            </div>
          </div>

          <!-- Attribution Table: Which weapons affected which time points -->
          <div class="attribution-table-panel tech-panel">
            <div class="panel-subtitle">武器影响时间点与延时归因明细表</div>
            <table class="tech-table">
              <thead>
                <tr>
                  <th>打击发生时间点</th>
                  <th>红方武器名称 / ID</th>
                  <th>武器分类 / 毁伤性质</th>
                  <th>受影响蓝方目标</th>
                  <th>施加延时影响 (Delay Contribution)</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="(item, idx) in matrices.earliestFullChain.attributions" :key="idx">
                  <td class="digital-font text-cyan">
                    T+{{ item.minute }}m ({{ formatTime(item.time) }})
                  </td>
                  <td>
                    <span class="bold-text text-red">{{ item.weapon_name || item.weapon_id }}</span>
                  </td>
                  <td>
                    <span class="tag-pill" :class="item.kill_type === 'HARD' ? 'tag-hard' : 'tag-soft'">
                      {{ item.category }} ({{ item.kill_type === 'HARD' ? '硬摧毁' : '软干扰' }})
                    </span>
                  </td>
                  <td>
                    <span class="node-badge node-blue">{{ item.target_name || item.target_id }}</span>
                  </td>
                  <td class="digital-font font-large text-red bold-text">
                    +{{ item.delay_impact }} 秒
                  </td>
                </tr>
                <tr v-if="!matrices.earliestFullChain.attributions || matrices.earliestFullChain.attributions.length === 0">
                  <td colspan="5" class="text-center text-dim">在该传输时间窗内未遭受红方成功开火打压</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
        <div v-else class="text-dim text-center padding-large">
          暂未解算出全链路传输数据，请点击“重新解算矩阵”。
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue';
import type { TacticalMatrices, EarliestFullChainAnalysis } from '../../types/electronic';

const props = defineProps<{
  matrices: TacticalMatrices | null;
  loading: boolean;
}>();

const emit = defineEmits<{
  (e: 'refresh'): void;
  (e: 'highlight-fullchain', data: EarliestFullChainAnalysis): void;
}>();

const activeSubTab = ref<'PASS' | 'VISIBILITY' | 'OVERHEAD' | 'ATTACK' | 'FULLCHAIN'>('PASS');
const searchQuery = ref('');

const handleRefresh = () => {
  emit('refresh');
};

/**
 * 触发高亮全链路事件
 */
const handleHighlightFullChain = () => {
  if (props.matrices && props.matrices.earliestFullChain) {
    emit('highlight-fullchain', props.matrices.earliestFullChain);
  }
};

const isEmpty = computed(() => {
  if (!props.matrices) return true;
  const { passMatrix, visibleMatrix, overheadMatrix, attackMatrix } = props.matrices;
  return (
    (!passMatrix || passMatrix.length === 0) &&
    (!visibleMatrix || visibleMatrix.length === 0) &&
    (!overheadMatrix || overheadMatrix.length === 0) &&
    (!attackMatrix || attackMatrix.length === 0)
  );
});

// Pass Matrix stats & filtering
const passMatrixStats = computed(() => {
  const list = props.matrices?.passMatrix || [];
  let totalWindows = 0;
  list.forEach(sat => {
    if (sat.windows) totalWindows += sat.windows.length;
  });
  return { satCount: list.length, totalWindows };
});

const filteredPassMatrix = computed(() => {
  const list = props.matrices?.passMatrix || [];
  if (!searchQuery.value.trim()) return list;
  const q = searchQuery.value.toLowerCase();
  return list.filter(item => 
    (item.sat_id && item.sat_id.toLowerCase().includes(q)) ||
    (item.sat_name && item.sat_name.toLowerCase().includes(q))
  );
});

// Visible Matrix stats & filtering
const visibleMatrixStats = computed(() => {
  const list = props.matrices?.visibleMatrix || [];
  let totalWindows = 0;
  list.forEach(pair => {
    if (pair.windows) totalWindows += pair.windows.length;
  });
  return { pairCount: list.length, totalWindows };
});

const filteredVisibleMatrix = computed(() => {
  const list = props.matrices?.visibleMatrix || [];
  if (!searchQuery.value.trim()) return list;
  const q = searchQuery.value.toLowerCase();
  return list.filter(item => 
    (item.source_id && item.source_id.toLowerCase().includes(q)) ||
    (item.target_id && item.target_id.toLowerCase().includes(q)) ||
    (item.source_name && item.source_name.toLowerCase().includes(q)) ||
    (item.target_name && item.target_name.toLowerCase().includes(q))
  );
});

// Overhead Matrix stats & filtering
const overheadMatrixStats = computed(() => {
  const list = props.matrices?.overheadMatrix || [];
  if (list.length === 0) return { avgOverhead: 0, maxOverhead: 0 };
  const sum = list.reduce((acc, curr) => acc + (curr.total_overhead || 0), 0);
  const max = Math.max(...list.map(curr => curr.total_overhead || 0));
  return {
    avgOverhead: Math.round(sum / list.length),
    maxOverhead: max
  };
});

const filteredOverheadMatrix = computed(() => {
  const list = props.matrices?.overheadMatrix || [];
  if (!searchQuery.value.trim()) return list;
  const q = searchQuery.value.toLowerCase();
  return list.filter(item => 
    (item.source_id && item.source_id.toLowerCase().includes(q)) ||
    (item.target_id && item.target_id.toLowerCase().includes(q)) ||
    (item.source_name && item.source_name.toLowerCase().includes(q)) ||
    (item.target_name && item.target_name.toLowerCase().includes(q))
  );
});

// Attack Matrix stats & filtering
const attackMatrixStats = computed(() => {
  const list = props.matrices?.attackMatrix || [];
  const executedCount = list.filter(item => item.is_executed).length;
  return { targetCount: list.length, executedCount };
});

const filteredAttackMatrix = computed(() => {
  const list = props.matrices?.attackMatrix || [];
  if (!searchQuery.value.trim()) return list;
  const q = searchQuery.value.toLowerCase();
  return list.filter(item => 
    (item.weapon_id && item.weapon_id.toLowerCase().includes(q)) ||
    (item.weapon_name && item.weapon_name.toLowerCase().includes(q)) ||
    (item.target_id && item.target_id.toLowerCase().includes(q)) ||
    (item.target_name && item.target_name.toLowerCase().includes(q)) ||
    (item.category && item.category.toLowerCase().includes(q))
  );
});

// Format timestamp to hh:mm:ss
const formatTime = (timestamp: number): string => {
  if (!timestamp) return '00:00:00';
  const date = new Date(timestamp * 1000);
  const h = String(date.getUTCHours()).padStart(2, '0');
  const m = String(date.getUTCMinutes()).padStart(2, '0');
  const s = String(date.getUTCSeconds()).padStart(2, '0');
  return `${h}:${m}:${s}`;
};

const getStatusBadgeClass = (status: string) => {
  if (status === 'TRANSMITTING') return 'status-green';
  if (status === 'JAMMED') return 'status-yellow';
  if (status === 'DESTROYED') return 'status-red';
  return 'status-cyan';
};

const getStatusText = (status: string) => {
  if (status === 'TRANSMITTING') return '⚡ 正常传输';
  if (status === 'JAMMED') return '⚠️ 电磁干扰中';
  if (status === 'DESTROYED') return '💥 物理摧毁毁伤';
  return status;
};

const getDelayColorClass = (delay: number) => {
  if (delay > 100) return 'text-red bold-text';
  if (delay > 45) return 'text-yellow';
  return 'text-cyan';
};

const getLayerTagClass = (layer: number) => {
  if (layer === 2) return 'tag-space';
  if (layer === 1) return 'tag-air';
  return 'tag-ground';
};

const getWeaponIcon = (category: string) => {
  if (category === 'DEW') return '⚡';
  if (category === 'CYBER') return '💻';
  if (category === 'EW') return '📡';
  if (category === 'KINETIC') return '🚀';
  return '⚔️';
};
</script>

<style scoped>
.tactical-matrix-view {
  display: flex;
  flex-direction: column;
  gap: 16px;
  width: 100%;
  height: 100%;
  flex: 1;
  min-height: 0;
  box-sizing: border-box;
  overflow-y: auto;
}

/* Console Toolbar */
.matrix-toolbar {
  padding: 14px 20px;
  border-radius: 8px;
  background: rgba(13, 20, 36, 0.75);
  border: 1px solid rgba(0, 240, 255, 0.25);
  backdrop-filter: blur(10px);
  flex-shrink: 0;
}

.toolbar-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.toolbar-title {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 18px;
  font-weight: 700;
}

.title-icon {
  font-size: 22px;
}

.scenario-tag {
  font-size: 11px;
  font-family: monospace;
  background: rgba(0, 240, 255, 0.12);
  color: #00f0ff;
  padding: 3px 8px;
  border-radius: 4px;
  border: 1px solid rgba(0, 240, 255, 0.3);
}

.toolbar-actions {
  display: flex;
  align-items: center;
  gap: 12px;
}

.search-box .tech-input {
  background: rgba(8, 14, 28, 0.8);
  border: 1px solid rgba(0, 240, 255, 0.3);
  color: #e2e8f0;
  padding: 6px 12px;
  border-radius: 4px;
  font-size: 13px;
  outline: none;
  width: 240px;
  transition: all 0.2s ease;
}

.search-box .tech-input:focus {
  border-color: #00f0ff;
  box-shadow: 0 0 8px rgba(0, 240, 255, 0.4);
}

.tech-btn {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 7px 16px;
  border-radius: 4px;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  border: none;
  transition: all 0.2s ease;
}

.btn-cyan {
  background: linear-gradient(135deg, rgba(0, 240, 255, 0.2), rgba(0, 150, 255, 0.4));
  color: #00f0ff;
  border: 1px solid rgba(0, 240, 255, 0.5);
}

.btn-cyan:hover:not(:disabled) {
  background: linear-gradient(135deg, rgba(0, 240, 255, 0.4), rgba(0, 180, 255, 0.6));
  box-shadow: 0 0 12px rgba(0, 240, 255, 0.5);
}

.btn-cyan:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.spin-icon {
  display: inline-block;
  animation: spin 1s linear infinite;
}

@keyframes spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}

/* KPI Cards Row */
.kpi-cards-row {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 16px;
  flex-shrink: 0;
}

.kpi-card {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 16px;
  border-radius: 8px;
  background: rgba(13, 20, 36, 0.6);
  border: 1px solid rgba(255, 255, 255, 0.08);
}

.bg-gradient-cyan {
  background: linear-gradient(135deg, rgba(0, 240, 255, 0.08) 0%, rgba(13, 20, 36, 0.6) 100%);
  border-color: rgba(0, 240, 255, 0.25);
}

.bg-gradient-blue {
  background: linear-gradient(135deg, rgba(59, 130, 246, 0.08) 0%, rgba(13, 20, 36, 0.6) 100%);
  border-color: rgba(59, 130, 246, 0.25);
}

.bg-gradient-yellow {
  background: linear-gradient(135deg, rgba(234, 179, 8, 0.08) 0%, rgba(13, 20, 36, 0.6) 100%);
  border-color: rgba(234, 179, 8, 0.25);
}

.bg-gradient-red {
  background: linear-gradient(135deg, rgba(239, 68, 68, 0.08) 0%, rgba(13, 20, 36, 0.6) 100%);
  border-color: rgba(239, 68, 68, 0.25);
}

.card-icon {
  font-size: 28px;
}

.card-content {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.card-label {
  font-size: 12px;
  color: #94a3b8;
}

.card-value-group {
  display: flex;
  align-items: baseline;
  gap: 6px;
}

.card-value {
  font-size: 24px;
  font-weight: 700;
}

.card-unit {
  font-size: 13px;
  color: #cbd5e1;
}

.card-sub-val {
  font-size: 11px;
  color: #64748b;
}

/* Sub Tabs Nav */
.matrix-nav-row {
  padding: 8px 12px;
  background: rgba(13, 20, 36, 0.7);
  border-radius: 8px;
  border: 1px solid rgba(255, 255, 255, 0.08);
  flex-shrink: 0;
}

.matrix-tabs {
  display: flex;
  gap: 10px;
}

.matrix-tab-btn {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 18px;
  background: rgba(18, 28, 48, 0.5);
  border: 1px solid rgba(255, 255, 255, 0.1);
  color: #94a3b8;
  border-radius: 6px;
  cursor: pointer;
  font-size: 14px;
  font-weight: 600;
  transition: all 0.2s ease;
}

.matrix-tab-btn:hover {
  color: #00f0ff;
  border-color: rgba(0, 240, 255, 0.4);
  background: rgba(0, 240, 255, 0.08);
}

.matrix-tab-btn.active {
  background: linear-gradient(135deg, rgba(0, 240, 255, 0.25), rgba(0, 120, 255, 0.3));
  color: #ffffff;
  border-color: #00f0ff;
  box-shadow: 0 0 10px rgba(0, 240, 255, 0.3);
}

.badge-count {
  font-size: 11px;
  font-family: monospace;
  background: rgba(0, 0, 0, 0.4);
  padding: 2px 6px;
  border-radius: 10px;
  color: #00f0ff;
}

/* Matrix Content Container */
.matrix-content-container {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

/* Pane & Tables */
.tab-pane {
  padding: 20px;
  background: rgba(13, 20, 36, 0.75);
  border-radius: 8px;
  border: 1px solid rgba(0, 240, 255, 0.2);
  display: flex;
  flex-direction: column;
  gap: 16px;
  flex: 1;
  min-height: 0;
  overflow: hidden;
}

.pane-header {
  border-bottom: 1px dashed rgba(255, 255, 255, 0.1);
  padding-bottom: 10px;
  flex-shrink: 0;
}

.pane-title {
  font-size: 16px;
  font-weight: 700;
  color: #00f0ff;
}

.pane-desc {
  font-size: 12px;
  color: #64748b;
  margin-top: 4px;
}

.table-wrapper {
  flex: 1;
  min-height: 250px;
  max-height: calc(100vh - 350px);
  overflow-x: auto;
  overflow-y: auto;
  border-radius: 6px;
  border: 1px solid rgba(0, 240, 255, 0.15);
}

.table-wrapper::-webkit-scrollbar,
.matrix-content-container::-webkit-scrollbar,
.tactical-matrix-view::-webkit-scrollbar {
  width: 6px;
  height: 6px;
}

.table-wrapper::-webkit-scrollbar-track,
.matrix-content-container::-webkit-scrollbar-track,
.tactical-matrix-view::-webkit-scrollbar-track {
  background: rgba(8, 14, 28, 0.6);
  border-radius: 3px;
}

.table-wrapper::-webkit-scrollbar-thumb,
.matrix-content-container::-webkit-scrollbar-thumb,
.tactical-matrix-view::-webkit-scrollbar-thumb {
  background: rgba(0, 240, 255, 0.35);
  border-radius: 3px;
  border: 1px solid rgba(0, 240, 255, 0.5);
}

.table-wrapper::-webkit-scrollbar-thumb:hover,
.matrix-content-container::-webkit-scrollbar-thumb:hover,
.tactical-matrix-view::-webkit-scrollbar-thumb:hover {
  background: rgba(0, 240, 255, 0.7);
  box-shadow: 0 0 8px rgba(0, 240, 255, 0.6);
}

.tech-table {
  width: 100%;
  border-collapse: collapse;
  text-align: left;
  font-size: 13px;
}

.tech-table th {
  position: sticky;
  top: 0;
  z-index: 10;
  background: rgba(8, 14, 28, 0.95);
  color: #00f0ff;
  padding: 10px 14px;
  font-weight: 600;
  border-bottom: 1px solid rgba(0, 240, 255, 0.3);
  white-space: nowrap;
}

.tech-table td {
  padding: 10px 14px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.05);
  color: #cbd5e1;
  vertical-align: middle;
}

.tech-table tbody tr:hover {
  background: rgba(0, 240, 255, 0.04);
}

/* Badges & Tags */
.tag-pill {
  display: inline-block;
  padding: 3px 8px;
  border-radius: 4px;
  font-size: 11px;
  font-weight: 600;
}

.tag-space { background: rgba(168, 85, 247, 0.2); color: #c084fc; border: 1px solid rgba(168, 85, 247, 0.4); }
.tag-air { background: rgba(59, 130, 246, 0.2); color: #60a5fa; border: 1px solid rgba(59, 130, 246, 0.4); }
.tag-ground { background: rgba(34, 197, 94, 0.2); color: #4ade80; border: 1px solid rgba(34, 197, 94, 0.4); }
.tag-sat-station { background: rgba(0, 240, 255, 0.15); color: #00f0ff; border: 1px solid rgba(0, 240, 255, 0.3); }
.tag-station-cmd { background: rgba(245, 158, 11, 0.15); color: #fbbf24; border: 1px solid rgba(245, 158, 11, 0.3); }
.tag-hard { background: rgba(239, 68, 68, 0.2); color: #f87171; border: 1px solid rgba(239, 68, 68, 0.4); }
.tag-soft { background: rgba(234, 179, 8, 0.2); color: #facc15; border: 1px solid rgba(234, 179, 8, 0.4); }

.node-badge {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 4px 8px;
  border-radius: 4px;
  font-weight: 600;
  font-size: 12px;
}
.node-blue { background: rgba(0, 240, 255, 0.1); color: #38bdf8; border: 1px solid rgba(0, 240, 255, 0.25); }
.node-green { background: rgba(34, 197, 94, 0.1); color: #4ade80; border: 1px solid rgba(34, 197, 94, 0.25); }

.window-pill-list {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.window-pill {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  background: rgba(15, 23, 42, 0.8);
  border: 1px solid rgba(255, 255, 255, 0.1);
  padding: 4px 10px;
  border-radius: 4px;
  font-size: 12px;
}

.pill-cyan { border-color: rgba(0, 240, 255, 0.3); }
.pill-red { border-color: rgba(239, 68, 68, 0.3); }

.pill-label { color: #94a3b8; font-size: 11px; }
.duration-badge { color: #38bdf8; font-size: 11px; }

.status-badge {
  display: inline-block;
  padding: 4px 10px;
  border-radius: 12px;
  font-size: 12px;
  font-weight: 600;
}

.status-green { background: rgba(34, 197, 94, 0.2); color: #4ade80; border: 1px solid rgba(34, 197, 94, 0.4); }
.status-yellow { background: rgba(234, 179, 8, 0.2); color: #facc15; border: 1px solid rgba(234, 179, 8, 0.4); }
.status-red { background: rgba(239, 68, 68, 0.2); color: #f87171; border: 1px solid rgba(239, 68, 68, 0.4); }
.status-cyan { background: rgba(0, 240, 255, 0.2); color: #00f0ff; border: 1px solid rgba(0, 240, 255, 0.4); }

.link-pair {
  display: flex;
  align-items: center;
  gap: 6px;
}
.arrow-icon { color: #00f0ff; font-weight: bold; }

.weapon-info {
  display: flex;
  align-items: center;
  gap: 8px;
}
.weapon-icon { font-size: 16px; }
.category-pill {
  font-size: 10px;
  background: rgba(255, 255, 255, 0.08);
  color: #94a3b8;
  padding: 2px 6px;
  border-radius: 3px;
}

/* Loading & Empty States */
.matrix-loading-state, .matrix-empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 60px 20px;
  border-radius: 8px;
  gap: 16px;
  background: rgba(13, 20, 36, 0.7);
  border: 1px solid rgba(0, 240, 255, 0.2);
}

.loading-spinner {
  width: 40px;
  height: 40px;
  border: 3px solid rgba(0, 240, 255, 0.2);
  border-top-color: #00f0ff;
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}

.empty-icon { font-size: 40px; }
.empty-text { color: #94a3b8; font-size: 14px; }

/* Text Utilities */
.digital-font { font-family: 'Share Tech Mono', monospace, Consolas; }
.font-large { font-size: 15px; font-weight: bold; }
.bold-text { font-weight: 600; }
.text-cyan { color: #00f0ff; }
.text-yellow { color: #facc15; }
.text-red { color: #f87171; }
.text-green { color: #4ade80; }
.text-dim { color: #64748b; }
.glow-text-cyan {
  color: #00f0ff;
  text-shadow: 0 0 10px rgba(0, 240, 255, 0.5);
}

/* Full Chain Styles */
.highlight-gold-btn {
  border-color: rgba(255, 204, 0, 0.4) !important;
}

.highlight-gold-btn.active {
  background: linear-gradient(135deg, rgba(255, 204, 0, 0.25), rgba(255, 150, 0, 0.3)) !important;
  color: #fffbcf !important;
  border-color: #ffcc00 !important;
  box-shadow: 0 0 12px rgba(255, 204, 0, 0.4) !important;
}

.text-gold {
  color: #ffcc00 !important;
}

.btn-gold {
  background: linear-gradient(135deg, rgba(255, 204, 0, 0.25), rgba(255, 128, 0, 0.3));
  border: 1px solid #ffcc00;
  color: #fffbcf;
  padding: 6px 14px;
  border-radius: 4px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.2s ease;
}

.btn-gold:hover {
  background: linear-gradient(135deg, rgba(255, 204, 0, 0.4), rgba(255, 128, 0, 0.5));
  box-shadow: 0 0 12px rgba(255, 204, 0, 0.6);
  transform: translateY(-1px);
}

.flex-title {
  display: flex;
  justify-content: space-between;
  align-items: center;
  width: 100%;
}

.fullchain-analysis-container {
  display: flex;
  flex-direction: column;
  gap: 16px;
  overflow-y: auto;
  flex: 1;
}

.fullchain-cards .kpi-card {
  flex: 1;
}

.path-flow-panel {
  padding: 16px;
  background: rgba(8, 14, 28, 0.6);
  border: 1px solid rgba(0, 240, 255, 0.2);
  border-radius: 6px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.panel-subtitle {
  font-size: 14px;
  font-weight: 700;
  color: #ffcc00;
  border-left: 3px solid #ffcc00;
  padding-left: 8px;
}

.path-steps {
  display: flex;
  align-items: center;
  justify-content: space-around;
  background: rgba(13, 22, 40, 0.8);
  padding: 16px;
  border-radius: 6px;
  border: 1px dashed rgba(255, 204, 0, 0.3);
}

.path-step-item {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
}

.step-badge {
  font-size: 11px;
  padding: 2px 8px;
  border-radius: 10px;
  font-weight: 600;
}

.step-sat {
  background: rgba(0, 225, 255, 0.15);
  color: #00e1ff;
  border: 1px solid rgba(0, 225, 255, 0.4);
}

.step-station {
  background: rgba(16, 185, 129, 0.15);
  color: #10b981;
  border: 1px solid rgba(16, 185, 129, 0.4);
}

.step-cmd {
  background: rgba(168, 85, 247, 0.15);
  color: #c084fc;
  border: 1px solid rgba(168, 85, 247, 0.4);
}

.step-name {
  font-size: 14px;
  font-weight: 700;
  color: #ffffff;
}

.path-arrow {
  letter-spacing: 2px;
}

.attribution-table-panel {
  padding: 16px;
  background: rgba(8, 14, 28, 0.6);
  border: 1px solid rgba(0, 240, 255, 0.2);
  border-radius: 6px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}
</style>
