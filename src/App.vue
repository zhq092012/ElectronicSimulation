<template>
  <div class="grid-bg min-h-screen p-5 flex flex-col box-border">
    <!-- Top Sci-Fi Header -->
    <header class="tech-panel flex justify-between items-center mb-5 py-3 px-6">
      <div class="flex items-center gap-6">
        <div class="header-logo glow-text-cyan text-xl font-bold">CEMA SIM PLATFORM V1.0</div>
        
        <!-- View Switcher Tabs -->
        <nav class="flex gap-2">
          <button 
            :class="['px-3 py-1.5 text-xs rounded border transition font-bold cursor-pointer', currentView === 'SANDBOX' ? 'bg-cyan-500/20 border-cyan-400 text-cyan-300' : 'bg-transparent border-cyan-950/30 text-dim hover:text-cyan-400']"
            @click="currentView = 'SANDBOX'"
          >
            🖥️ 推演主沙盘
          </button>
          <button 
            :class="['px-3 py-1.5 text-xs rounded border transition font-bold cursor-pointer', currentView === 'AAR' ? 'bg-cyan-500/20 border-cyan-400 text-cyan-300' : 'bg-transparent border-cyan-950/30 text-dim hover:text-cyan-400']"
            @click="currentView = 'AAR'"
          >
            📊 战后效能复盘
          </button>
        </nav>
      </div>
      
      <!-- Simulation Status Indicators -->
      <div class="flex items-center gap-6">
        <div class="flex items-center gap-2">
          <span class="text-xs text-dim">推演时钟:</span>
          <span class="digital-font text-lg text-cyan glow-text-cyan">{{ formatTime(simTime) }}</span>
        </div>
        <div class="flex items-center gap-2">
          <span class="text-xs text-dim">红方预算消耗:</span>
          <span class="digital-font text-lg text-red glow-text-red">${{ formatNumber(budgetSpent) }} / ${{ formatNumber(maxBudget) }}</span>
        </div>
        <div class="flex items-center gap-2">
          <span class="text-xs text-dim">数据库状态:</span>
          <span class="flex items-center gap-1">
            <span :class="['w-2 h-2 rounded-full inline-block', isDbInitialized ? 'bg-green-500 shadow-green' : 'bg-red-500 shadow-red']"></span>
            <span class="text-xs digital-font">{{ isDbInitialized ? 'SQLite-Wasm (OPFS)' : '连接中...' }}</span>
          </span>
        </div>
        <el-button size="small" type="primary" plain @click="openSqlSandbox">
          🗄️ SQL 数据沙箱
        </el-button>
      </div>
    </header>

    <!-- Main Workspace Grid -->
    <div v-if="currentView === 'SANDBOX'" class="flex-1 flex flex-row gap-5 min-h-0 w-full overflow-hidden">
      
      <!-- Left Panel: Control Panel (25%) -->
      <section class="w-1/4 flex flex-col gap-5 min-h-0">
        <!-- Controls Panel -->
        <div class="tech-panel flex-none">
          <div class="panel-header">
            <span>战术参数设定</span>
            <span class="text-xs text-dim">Tactical Config</span>
          </div>
          <el-form label-position="left" label-width="90px" class="text-xs mt-3 px-2">
            <el-form-item label="交战烈度:" class="mb-3">
              <el-select v-model="conflictIntensity" size="small" class="w-full">
                <el-option label="低烈度 (软杀伤)" value="LOW" />
                <el-option label="中烈度 (软/定向能)" value="MEDIUM" />
                <el-option label="高烈度 (动能全开)" value="HIGH" />
              </el-select>
            </el-form-item>
            <el-form-item label="压制时长:" class="mb-3">
              <el-input-number v-model="suppressionTime" size="small" :min="10" :max="120" class="w-full" />
            </el-form-item>
            <el-form-item label="代价上限:" class="mb-3">
              <el-input v-model="maxBudget" size="small" class="w-full" placeholder="输入预算">
                <template #prefix>$</template>
              </el-input>
            </el-form-item>
            <el-form-item label="政治红线:" class="mb-4">
              <el-select v-model="politicalRedline" size="small" class="w-full">
                <el-option label="严格/灰色地带 (禁打民用)" value="STRICT" />
                <el-option label="局部冲突 (特定区域)" value="LOCAL" />
                <el-option label="全面战争 (无限制)" value="TOTAL" />
              </el-select>
            </el-form-item>
            
            <div class="flex gap-2">
              <el-button type="primary" size="small" class="flex-1" @click="loadMockScenario">
                ⚡ 初始化数据
              </el-button>
              <el-button type="success" size="small" class="flex-1" :disabled="!isScenarioLoaded" @click="runOrbitCalculation">
                🛰️ 轨道视算
              </el-button>
            </div>
            
            <el-button 
              :type="isPlaying ? 'warning' : 'danger'" 
              size="small" 
              class="w-full font-bold mt-2" 
              :disabled="!isScenarioLoaded" 
              @click="togglePlay"
            >
              {{ isPlaying ? '⏸ 暂停自动推演' : '▶ 开始交战推演' }}
            </el-button>
            
            <el-button 
              type="success" 
              size="small" 
              class="w-full font-bold mt-2" 
              :disabled="simMinutes < 50" 
              @click="savePlan"
            >
              💾 保存方案用于复盘
            </el-button>
          </el-form>

          <!-- Slider representing minutes of the simulation -->
          <div class="mt-4 px-2">
            <div class="flex justify-between text-xs mb-1">
              <span class="text-dim">推演步长演进:</span>
              <span class="text-cyan-400 digital-font">{{ simMinutes }} / 50 min</span>
            </div>
            <el-slider v-model="simMinutes" :min="0" :max="50" :step="1" :disabled="!isScenarioLoaded" @change="onTimeStepChange" />
          </div>
        </div>

        <!-- Combat Event History (Timeline) -->
        <div class="tech-panel flex-1 flex flex-col min-h-0">
          <div class="panel-header">
            <span>动态推演时间轴</span>
            <span class="text-xs digital-font">Timeline</span>
          </div>
          <div ref="timelineContainer" class="flex-1 overflow-y-auto bg-black/40 p-4 rounded border border-cyan-900/50">
            <el-timeline v-if="filteredLogs.length > 0">
              <el-timeline-item
                v-for="(log, index) in filteredLogs"
                :key="index"
                :type="log.level === 'error' ? 'danger' : log.level === 'warning' ? 'warning' : 'primary'"
                size="normal"
                :timestamp="log.time"
              >
                <div class="text-xs text-dim leading-snug">{{ log.message }}</div>
              </el-timeline-item>
            </el-timeline>
            <div v-else class="text-dim text-center mt-10 text-xs">暂无推演事件</div>
          </div>
        </div>
      </section>

      <!-- Center Panel: Wargaming 3D/2D Topology (50%) -->
      <section class="w-1/2 tech-panel flex flex-col min-h-0 relative">
        <div class="panel-header">
          <span>空天地立体对抗网络拓扑视口</span>
          <div class="flex gap-2">
            <span class="side-tag blue-side">蓝方全链路</span>
            <span class="side-tag red-side">红方干扰阵地</span>
          </div>
        </div>

        <!-- Network Topology Canvas (3D Force Graph) -->
        <div class="flex-1 bg-black/60 rounded border border-cyan-950/60 relative overflow-hidden flex flex-col min-h-0">
          <Battlefield3D 
            v-if="isScenarioLoaded"
            :nodes="assets" 
            :links="links" 
            @select-node="selectEntity" 
          />
          <div v-else class="flex-1 flex items-center justify-center text-dim text-xs">
            请在左侧点击“初始化数据”载入推演场景
          </div>
        </div>
      </section>

      <!-- Right Panel: BDA Dashboard (25%) -->
      <section class="w-1/4 flex flex-col gap-5 min-h-0">
        
        <!-- Radar Chart -->
        <div class="tech-panel h-[250px] flex flex-col min-h-0">
          <div class="panel-header">
            <span>综合效能动态评估</span>
            <span class="text-xs text-dim">Live BDA Radar</span>
          </div>
          <div ref="smallRadarChartRef" class="flex-1 w-full min-h-[150px]"></div>
        </div>

        <!-- Weapon Assignment Table -->
        <div class="tech-panel flex-1 flex flex-col min-h-0">
          <WeaponAssignmentTable :currentTime="simTime" />
        </div>
        
        <!-- Tactical Entity Detail Card -->
        <div class="tech-panel flex-none h-[220px] flex flex-col">
          <div class="panel-header">
            <span>实体信息探针</span>
            <span class="text-xs text-dim">Entity Inspector</span>
          </div>

          <div class="flex-1 overflow-y-auto text-xs">
            <div v-if="selectedEntity">
              <div class="flex justify-between items-center mb-3">
                <span class="text-sm font-bold text-cyan-300">{{ selectedEntity.name || selectedEntity.id }}</span>
                <span :class="['side-tag', selectedEntity.side === 'RED' ? 'red-side' : 'blue-side']">
                  {{ selectedEntity.side === 'RED' ? '红方武器' : '蓝方资产' }}
                </span>
              </div>

              <!-- Asset Detail Table -->
              <div v-if="selectedType === 'ASSET'" class="grid grid-cols-2 gap-x-4 gap-y-1.5">
                <div><span class="text-dim">实体类型:</span> <span class="digital-font">{{ selectedEntity.asset_class }}</span></div>
                <div><span class="text-dim">核心功能:</span> <span class="digital-font">{{ selectedEntity.func_type }}</span></div>
                <div><span class="text-dim">所有权:</span> <span class="digital-font">{{ selectedEntity.usage_type }}</span></div>
                <div><span class="text-dim">空间分层:</span> <span class="digital-font">{{ getLayerLabel(selectedEntity.layer) }}</span></div>
                <div><span class="text-dim">抗干扰级:</span> <span class="digital-font text-yellow-400">{{ selectedEntity.anti_jam_level }}</span></div>
                <div><span class="text-dim">目标价值:</span> <span class="digital-font text-cyan-400">{{ selectedEntity.base_priority }}</span></div>
                <div class="col-span-2"><span class="text-dim">三维坐标:</span> <span class="digital-font">L:{{ selectedEntity.lat ? selectedEntity.lat.toFixed(2) : '计算中' }},{{ selectedEntity.lng ? selectedEntity.lng.toFixed(2) : '计算中' }} A:{{ selectedEntity.alt || 0 }}km</span></div>
                <div class="col-span-2"><span class="text-dim">雷达发现:</span> <span class="digital-font" :class="selectedEntity.is_detected_by_red ? 'text-red-400' : 'text-green-400'">{{ selectedEntity.is_detected_by_red ? '已被锁定' : '隐蔽中' }}</span></div>
              </div>

              <!-- Weapon Detail Table -->
              <div v-if="selectedType === 'WEAPON'" class="grid grid-cols-2 gap-x-4 gap-y-1.5">
                <div><span class="text-dim">杀伤分类:</span> <span class="digital-font">{{ selectedEntity.category }}</span></div>
                <div><span class="text-dim">毁伤机制:</span> <span class="digital-font">{{ selectedEntity.kill_type }}</span></div>
                <div><span class="text-dim">打击范围:</span> <span class="digital-font">{{ selectedEntity.max_range === -1 ? '全球' : selectedEntity.max_range + ' km' }}</span></div>
                <div><span class="text-dim">库存弹药:</span> <span class="digital-font">{{ selectedEntity.inventory === -1 ? '无限次' : selectedEntity.inventory }}</span></div>
                <div><span class="text-dim">单次耗费:</span> <span class="digital-font text-green-400">${{ formatNumber(selectedEntity.action_cost) }}</span></div>
                <div><span class="text-dim">升级红线:</span> <span class="digital-font text-red-400">{{ selectedEntity.political_risk }}</span></div>
              </div>
            </div>
            <div v-else class="text-dim text-center mt-5">点击 3D 拓扑节点，在此查看探针参数</div>
          </div>
        </div>

      </section>

    </div>
    
    <!-- AAR View -->
    <AfterActionReview v-else />
    
    <SqlSandboxDialog ref="sqlSandboxRef" />
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, nextTick, onBeforeUnmount, watch } from 'vue';
import * as echarts from 'echarts';
import { sqliteClient } from './db/sqlite-client';
import { seedMockData } from './db/seeder';
import Battlefield3D from './components/Battlefield3D.vue';
import WeaponAssignmentTable from './components/WeaponAssignmentTable.vue';
import AfterActionReview from './components/AfterActionReview.vue';
import SqlSandboxDialog from './components/SqlSandboxDialog.vue';
import { ElMessage } from 'element-plus';

// App state variables
const isDbInitialized = ref(false);
const isScenarioLoaded = ref(false);
const currentView = ref<'SANDBOX' | 'AAR'>('SANDBOX');
const sqlSandboxRef = ref<any>(null);

// Forms
const conflictIntensity = ref<'LOW' | 'MEDIUM' | 'HIGH'>('LOW');
const suppressionTime = ref(50);
const maxBudget = ref(600000);
const politicalRedline = ref<'STRICT' | 'LOCAL' | 'TOTAL'>('STRICT');

// Simulator state
const simTime = ref(1781683200); // Unix timestamp
const budgetSpent = ref(0);
const totalDelay = ref(30); // in seconds
const simMinutes = ref(0);

// Lists
const assets = ref<any[]>([]);
const links = ref<any[]>([]);

// Logs & Timeline
const logs = ref<any[]>([]);
const filteredLogs = ref<any[]>([]);
const timelineContainer = ref<HTMLElement | null>(null);

// Selected element detail
const selectedEntity = ref<any>(null);
const selectedType = ref<'ASSET' | 'WEAPON' | null>(null);

// Time Engine Event Loop State
const isPlaying = ref(false);
const playIntervalId = ref<any>(null);

// Small Radar Chart
const smallRadarChartRef = ref<HTMLDivElement | null>(null);
let smallRadarChart: echarts.ECharts | null = null;

onMounted(async () => {
  addLog('CEMA 推演引擎启动...', 'info');
  try {
    await sqliteClient.init();
    isDbInitialized.value = true;
    addLog('SQLite Wasm (OPFS) 线程初始化成功！', 'success');
    await refreshData();
  } catch (err: any) {
    addLog(`数据库加载失败: ${err.message}`, 'error');
  }
});

// Helper formatted methods
const formatTime = (ts: number) => {
  const date = new Date(ts * 1000);
  return date.toISOString().replace('T', ' ').substring(0, 19);
};

const formatNumber = (num: number) => {
  return num.toLocaleString();
};

const getLayerLabel = (layer: number) => {
  if (layer === 0) return '地基层 (Ground)';
  if (layer === 1) return '空基层 (Air)';
  if (layer === 2) return '天基层 (Space)';
  return '未知';
};

const addLog = (message: string, level: 'info' | 'success' | 'warning' | 'error' = 'info') => {
  const time = `T+${simMinutes.value}m`;
  const logItem = { time, message, level, minute: simMinutes.value };
  logs.value.push(logItem);
  filterLogs();
};

const filterLogs = () => {
  // Show logs up to current simulated minute
  filteredLogs.value = logs.value.filter(l => l.minute <= simMinutes.value);
  nextTick(() => {
    if (timelineContainer.value) {
      timelineContainer.value.scrollTop = timelineContainer.value.scrollHeight;
    }
  });
};

watch(simMinutes, filterLogs);

const openSqlSandbox = () => {
  if (sqlSandboxRef.value) {
    sqlSandboxRef.value.openDialog();
  }
};

const refreshData = async () => {
  try {
    const scen = await sqliteClient.query<any>("SELECT * FROM scenarios WHERE id = 'scen-001'");
    if (scen.length > 0) {
      isScenarioLoaded.value = true;
      simTime.value = scen[0].start_time + simMinutes.value * 60;
      
      const assetsList = await sqliteClient.query<any>("SELECT * FROM assets");
      assets.value = assetsList;

      // Only fetch active windows at this tick
      const linksList = await sqliteClient.query<any>(`
        SELECT * FROM communication_windows 
        WHERE ? BETWEEN window_start AND window_end
      `, [simTime.value]);
      links.value = linksList;
      
      const plans = await sqliteClient.query<any>("SELECT * FROM tactical_plans WHERE id = 'plan-001'");
      if (plans.length > 0) {
        budgetSpent.value = plans[0].total_cost;
        totalDelay.value = plans[0].total_delay_achieved;
      }
      
      updateSmallRadar();
    } else {
      isScenarioLoaded.value = false;
    }
  } catch (error) {
    console.error('Error refreshing data:', error);
  }
};

// Actions
const loadMockScenario = async () => {
  addLog('初始化数据...', 'info');
  try {
    await seedMockData(sqliteClient);
    addLog('导入基础场景数据完成！', 'success');
    simMinutes.value = 0;
    logs.value = [];
    await refreshData();
  } catch (error: any) {
    addLog(`场景初始化出错: ${error.message}`, 'error');
  }
};

const runOrbitCalculation = async () => {
  addLog('正在启动 satellite.js 轨道视算...', 'info');
  try {
    await sqliteClient.calculateWindows('scen-001');
    addLog('轨道计算视算完成！星地拓扑链路已生成。', 'success');
    await refreshData();
  } catch (error: any) {
    addLog(`轨道视算失败: ${error.message}`, 'error');
  }
};

const savePlan = async () => {
  ElMessage.success('方案已保存至数据库，请进入战后效能复盘大屏对比查看。');
};

const onTimeStepChange = async (val: any) => {
  simMinutes.value = val;
  simTime.value = 1781683200 + val * 60;

  if (isScenarioLoaded.value) {
    try {
      const res = await sqliteClient.allocateWeapons(conflictIntensity.value, simTime.value, 'scen-001');
      if (res && res.engagements_created > 0) {
        addLog(`进行交战解算：成功匹配 ${res.engagements_created} 次火力压制`, 'warning');
      }
      await refreshData();
    } catch (e: any) {
      addLog(`战术交战计算出错: ${e.message}`, 'error');
    }
  }
};

const togglePlay = () => {
  if (isPlaying.value) {
    stopSimulationLoop();
  } else {
    startSimulationLoop();
  }
};

const startSimulationLoop = () => {
  if (simMinutes.value >= 50) {
    simMinutes.value = 0; // 重头循环
  }
  isPlaying.value = true;
  addLog(`推演开始 (烈度: ${conflictIntensity.value}, 政治红线: ${politicalRedline.value})`, 'success');
  
  playIntervalId.value = setInterval(async () => {
    if (simMinutes.value >= suppressionTime.value) {
      addLog(`已达到设定的 ${suppressionTime.value} 分钟压制时长，推演结束。`, 'success');
      stopSimulationLoop();
      return;
    }
    const nextVal = simMinutes.value + 1;
    await onTimeStepChange(nextVal);
  }, 1000);
};

const stopSimulationLoop = () => {
  isPlaying.value = false;
  if (playIntervalId.value) {
    clearInterval(playIntervalId.value);
    playIntervalId.value = null;
  }
};

onBeforeUnmount(() => {
  stopSimulationLoop();
});

const selectEntity = async (id: string, type: 'ASSET' | 'WEAPON') => {
  selectedType.value = type;
  try {
    if (type === 'ASSET') {
      const rows = await sqliteClient.query<any>(`SELECT * FROM assets WHERE id = ?`, [id]);
      if (rows.length > 0) selectedEntity.value = rows[0];
    } else if (type === 'WEAPON') {
      const rows = await sqliteClient.query<any>(`SELECT * FROM weapons WHERE id = ?`, [id]);
      if (rows.length > 0) selectedEntity.value = rows[0];
    }
  } catch (error) {
    console.error('Error selecting entity:', error);
  }
};

const updateSmallRadar = async () => {
  if (!smallRadarChartRef.value) return;
  if (currentView.value !== 'SANDBOX') return;
  
  if (!smallRadarChart) {
    smallRadarChart = echarts.init(smallRadarChartRef.value, 'dark');
  }

  // Same logic as AAR
  const totalLinks = await sqliteClient.query<any>("SELECT COUNT(*) as cnt FROM communication_windows");
  const blockedLinks = await sqliteClient.query<any>("SELECT COUNT(*) as cnt FROM communication_windows WHERE link_status IN ('JAMMED', 'DESTROYED')");
  const tot = totalLinks[0]?.cnt || 0;
  const blk = blockedLinks[0]?.cnt || 0;
  const blockRate = tot > 0 ? Math.round((blk / tot) * 100) : 0;

  const blockScore = blockRate;
  const controlScore = Math.max(30, Math.round(100 - (budgetSpent.value / maxBudget.value) * 50)); 
  const costEfficiency = Math.min(95, Math.round((totalDelay.value / (budgetSpent.value + 100)) * 6000));
  const selfInterference = Math.max(20, Math.round(100 - (budgetSpent.value > 50000 ? 40 : 15)));

  const option = {
    backgroundColor: 'transparent',
    color: ['#00e1ff'],
    radar: {
      indicator: [
        { name: '阻断成功率', max: 100 },
        { name: '冲突控制', max: 100 },
        { name: '效费比', max: 100 },
        { name: '己方生存', max: 100 }
      ],
      splitArea: { areaStyle: { color: ['rgba(0, 225, 255, 0.05)', 'rgba(0, 225, 255, 0.1)'] } },
      axisLine: { lineStyle: { color: 'rgba(0, 225, 255, 0.3)' } },
      splitLine: { lineStyle: { color: 'rgba(0, 225, 255, 0.3)' } },
      name: { textStyle: { color: '#a0aec0', fontSize: 10 } }
    },
    series: [
      {
        type: 'radar',
        data: [
          {
            value: [blockScore, controlScore, costEfficiency, selfInterference],
            name: '当前推演方案',
            areaStyle: { color: 'rgba(0, 225, 255, 0.3)' },
            lineStyle: { width: 2 }
          }
        ]
      }
    ]
  };
  smallRadarChart.setOption(option);
};

watch(currentView, () => {
  nextTick(() => {
    if (currentView.value === 'SANDBOX' && smallRadarChartRef.value) {
      updateSmallRadar();
    }
  });
});

</script>

<style lang="scss">
@import "./styles/theme.scss";

// Header status glow
.shadow-green { box-shadow: 0 0 8px #10b981; }
.shadow-red { box-shadow: 0 0 8px #ef4444; }

// el-timeline customization
.el-timeline {
  padding-left: 0;
}
.el-timeline-item__content {
  color: #a0aec0;
}
</style>

<style>
/* CSS polyfill for Tailwind classes */
.flex { display: flex !important; }
.flex-col { flex-direction: column !important; }
.flex-row { flex-direction: row !important; }
.flex-1 { flex: 1 1 0% !important; min-height: 0 !important; min-width: 0 !important; }
.flex-none { flex: none !important; }
.grid { display: grid !important; }
.grid-cols-4 { grid-template-columns: repeat(4, minmax(0, 1fr)) !important; }
.grid-cols-12 { grid-template-columns: repeat(12, minmax(0, 1fr)) !important; }
.col-span-3 { grid-column: span 3 / span 3 !important; }
.col-span-5 { grid-column: span 5 / span 5 !important; }
.col-span-6 { grid-column: span 6 / span 6 !important; }
.col-span-7 { grid-column: span 7 / span 7 !important; }
.gap-2 { gap: 8px !important; }
.gap-3 { gap: 12px !important; }
.gap-4 { gap: 16px !important; }
.gap-5 { gap: 20px !important; }
.gap-6 { gap: 24px !important; }
.w-full { width: 100% !important; }
.h-full { height: 100% !important; }
.w-1\/4 { width: 25% !important; }
.w-1\/2 { width: 50% !important; }
.min-h-0 { min-height: 0 !important; }
.min-w-0 { min-width: 0 !important; }
.min-h-screen { min-height: 100vh !important; }
.h-screen { height: 100vh !important; }
.overflow-hidden { overflow: hidden !important; }
.overflow-y-auto { overflow-y: auto !important; }
.box-border { box-sizing: border-box !important; }
.relative { position: relative !important; }
.p-5 { padding: 20px !important; }
.py-3 { padding-top: 12px !important; padding-bottom: 12px !important; }
.px-6 { padding-left: 24px !important; padding-right: 24px !important; }
.mb-3 { margin-bottom: 12px !important; }
.mb-4 { margin-bottom: 16px !important; }
.mb-5 { margin-bottom: 20px !important; }
.mt-2 { margin-top: 8px !important; }
.mt-3 { margin-top: 12px !important; }
.mt-4 { margin-top: 16px !important; }
.justify-between { justify-content: space-between !important; }
.items-center { align-items: center; }
.items-stretch { align-items: stretch; }
.flex-wrap { flex-wrap: wrap; }
</style>
