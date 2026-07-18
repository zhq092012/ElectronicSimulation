<template>
  <div class="app-container grid-bg">
    <!-- Top Sci-Fi Header -->
    <header class="app-header tech-panel">
      <div class="header-left">
        <div class="header-logo glow-text-cyan">CEMA SIM PLATFORM V1.0</div>
        
        <!-- View Switcher Tabs -->
        <nav class="nav-tabs">
          <button 
            class="tab-btn"
            :class="{ active: currentView === 'SANDBOX' }"
            @click="currentView = 'SANDBOX'"
          >
            🖥️ 推演主沙盘
          </button>
          <button 
            class="tab-btn"
            :class="{ active: currentView === 'AAR' }"
            @click="currentView = 'AAR'"
          >
            📊 战后效能复盘
          </button>
        </nav>
      </div>
      
      <!-- Simulation Status Indicators -->
      <div class="header-right">
        <div class="header-right-item">
          <span class="label-text">推演时钟:</span>
          <span class="digital-font time-value glow-text-cyan">{{ formatTime(simTime) }}</span>
        </div>
        <div class="header-right-item">
          <span class="label-text">红方预算消耗:</span>
          <span class="digital-font budget-value glow-text-red">${{ formatNumber(budgetSpent) }} / ${{ formatNumber(maxBudget) }}</span>
        </div>
        <div class="header-right-item">
          <span class="label-text">数据库状态:</span>
          <span class="db-status-container">
            <span :class="['status-dot', isDbInitialized ? 'status-green' : 'status-red']"></span>
            <span class="status-text digital-font">{{ isDbInitialized ? 'SQLite-Wasm (OPFS)' : '连接中...' }}</span>
          </span>
        </div>
        <el-button size="small" type="primary" plain @click="openSqlSandbox">
          🗄️ SQL 数据沙箱
        </el-button>
      </div>
    </header>

    <!-- Main Workspace Grid -->
    <div v-if="currentView === 'SANDBOX'" class="sandbox-workspace">
      
      <!-- Left Panel: Control Panel (25%) -->
      <section class="left-sidebar">
        <!-- Controls Panel -->
        <div class="tech-panel config-panel">
          <div class="panel-header">
            <span>战术参数设定</span>
            <span class="header-subtitle">Tactical Config</span>
          </div>
          <el-form label-position="left" label-width="90px" class="config-form">
            <el-form-item label="交战烈度:" class="form-item-intensity">
              <el-select v-model="conflictIntensity" size="small" class="form-input-full">
                <el-option label="低烈度 (软杀伤)" value="LOW" />
                <el-option label="中烈度 (软/定向能)" value="MEDIUM" />
                <el-option label="高烈度 (动能全开)" value="HIGH" />
              </el-select>
            </el-form-item>
            <el-form-item label="压制时长:" class="form-item-suppression">
              <el-input-number v-model="suppressionTime" size="small" :min="10" :max="120" class="form-input-full" />
            </el-form-item>
            <el-form-item label="代价上限:" class="form-item-budget">
              <el-input v-model="maxBudget" size="small" class="form-input-full" placeholder="输入预算">
                <template #prefix>$</template>
              </el-input>
            </el-form-item>
            <el-form-item label="政治红线:" class="form-item-redline">
              <el-select v-model="politicalRedline" size="small" class="form-input-full">
                <el-option label="严格/灰色地带 (禁打民用)" value="STRICT" />
                <el-option label="局部冲突 (特定区域)" value="LOCAL" />
                <el-option label="全面战争 (无限制)" value="TOTAL" />
              </el-select>
            </el-form-item>
            
            <div class="action-btn-row">
              <el-button type="primary" size="small" class="flex-btn" @click="loadMockScenario">
                ⚡ 初始化数据
              </el-button>
              <el-button type="success" size="small" class="flex-btn" :disabled="!isScenarioLoaded" @click="runOrbitCalculation">
                🛰️ 轨道视算
              </el-button>
            </div>
            
            <el-button 
              :type="isPlaying ? 'warning' : 'danger'" 
              size="small" 
              class="submit-btn font-bold-btn" 
              :disabled="!isScenarioLoaded" 
              @click="togglePlay"
            >
              {{ isPlaying ? '⏸ 暂停自动推演' : '▶ 开始交战推演' }}
            </el-button>
            
            <el-button 
              type="success" 
              size="small" 
              class="submit-btn font-bold-btn" 
              :disabled="simMinutes < 50" 
              @click="savePlan"
            >
              💾 保存方案用于复盘
            </el-button>
          </el-form>

          <!-- Slider representing minutes of the simulation -->
          <div class="time-slider-container">
            <div class="slider-header">
              <span class="label-text">推演步长演进:</span>
              <span class="time-progress digital-font">{{ simMinutes }} / 50 min</span>
            </div>
            <el-slider v-model="simMinutes" :min="0" :max="50" :step="1" :disabled="!isScenarioLoaded" @change="onTimeStepChange" />
          </div>
        </div>

        <!-- Combat Event History (Timeline) -->
        <div class="tech-panel timeline-panel">
          <div class="panel-header">
            <span>动态推演时间轴</span>
            <span class="header-subtitle digital-font">Timeline</span>
          </div>
          <div ref="timelineContainer" class="timeline-log-container">
            <el-timeline v-if="filteredLogs.length > 0">
              <el-timeline-item
                v-for="(log, index) in filteredLogs"
                :key="index"
                :type="log.level === 'error' ? 'danger' : log.level === 'warning' ? 'warning' : 'primary'"
                size="normal"
                :timestamp="log.time"
              >
                <div class="log-message">{{ log.message }}</div>
              </el-timeline-item>
            </el-timeline>
            <div v-else class="empty-log-message">暂无推演事件</div>
          </div>
        </div>
      </section>

      <!-- Center Panel: Wargaming 3D/2D Topology (50%) -->
      <section class="center-viewport tech-panel">
        <div class="panel-header">
          <span>空天地立体对抗网络拓扑视口</span>
          <div class="side-tags-row">
            <span class="side-tag blue-side">蓝方全链路</span>
            <span class="side-tag red-side">红方干扰阵地</span>
          </div>
        </div>

        <!-- Network Topology Canvas (3D Force Graph) -->
        <div class="canvas-container">
          <Battlefield3D 
            v-if="isScenarioLoaded"
            :nodes="assets" 
            :links="links" 
            @select-node="selectEntity" 
          />
          <div v-else class="empty-canvas-message">
            请在左侧点击“初始化数据”载入推演场景
          </div>
        </div>
      </section>

      <!-- Right Panel: BDA Dashboard (25%) -->
      <section class="right-sidebar">
        
        <!-- Radar Chart -->
        <div class="tech-panel radar-card">
          <div class="panel-header">
            <span>综合效能动态评估</span>
            <span class="header-subtitle">Live BDA Radar</span>
          </div>
          <div ref="smallRadarChartRef" class="small-radar-container"></div>
        </div>

        <!-- Weapon Assignment Table -->
        <div class="tech-panel weapon-assignment-card">
          <WeaponAssignmentTable :currentTime="simTime" />
        </div>
        
        <!-- Tactical Entity Detail Card -->
        <div class="tech-panel inspector-card">
          <div class="panel-header">
            <span>实体信息探针</span>
            <span class="header-subtitle">Entity Inspector</span>
          </div>

          <div class="inspector-details">
            <div v-if="selectedEntity">
              <div class="inspector-header">
                <span class="entity-name">{{ selectedEntity.name || selectedEntity.id }}</span>
                <span :class="['side-tag', selectedEntity.side === 'RED' ? 'red-side' : 'blue-side']">
                  {{ selectedEntity.side === 'RED' ? '红方武器' : '蓝方资产' }}
                </span>
              </div>

              <!-- Asset Detail Table -->
              <div v-if="selectedType === 'ASSET'" class="info-grid">
                <div><span class="label-dim">实体类型:</span> <span class="digital-font">{{ selectedEntity.asset_class }}</span></div>
                <div><span class="label-dim">核心功能:</span> <span class="digital-font">{{ selectedEntity.func_type }}</span></div>
                <div><span class="label-dim">所有权:</span> <span class="digital-font">{{ selectedEntity.usage_type }}</span></div>
                <div><span class="label-dim">空间分层:</span> <span class="digital-font">{{ getLayerLabel(selectedEntity.layer) }}</span></div>
                <div><span class="label-dim">抗干扰级:</span> <span class="digital-font value-yellow">{{ selectedEntity.anti_jam_level }}</span></div>
                <div><span class="label-dim">目标价值:</span> <span class="digital-font value-cyan">{{ selectedEntity.base_priority }}</span></div>
                <div class="grid-col-full"><span class="label-dim">三维坐标:</span> <span class="digital-font">L:{{ selectedEntity.lat ? selectedEntity.lat.toFixed(2) : '计算中' }},{{ selectedEntity.lng ? selectedEntity.lng.toFixed(2) : '计算中' }} A:{{ selectedEntity.alt || 0 }}km</span></div>
                <div class="grid-col-full">
                  <span class="label-dim">雷达发现:</span> 
                  <span :class="['digital-font', selectedEntity.is_detected_by_red ? 'detected-red' : 'hidden-green']">
                    {{ selectedEntity.is_detected_by_red ? '已被锁定' : '隐蔽中' }}
                  </span>
                </div>
              </div>

              <!-- Weapon Detail Table -->
              <div v-if="selectedType === 'WEAPON'" class="info-grid">
                <div><span class="label-dim">杀伤分类:</span> <span class="digital-font">{{ selectedEntity.category }}</span></div>
                <div><span class="label-dim">毁伤机制:</span> <span class="digital-font">{{ selectedEntity.kill_type }}</span></div>
                <div><span class="label-dim">打击范围:</span> <span class="digital-font">{{ selectedEntity.max_range === -1 ? '全球' : selectedEntity.max_range + ' km' }}</span></div>
                <div><span class="label-dim">库存弹药:</span> <span class="digital-font">{{ selectedEntity.inventory === -1 ? '无限次' : selectedEntity.inventory }}</span></div>
                <div><span class="label-dim">单次耗费:</span> <span class="digital-font value-green">${{ formatNumber(selectedEntity.action_cost) }}</span></div>
                <div><span class="label-dim">升级红线:</span> <span class="digital-font value-red">{{ selectedEntity.political_risk }}</span></div>
              </div>
            </div>
            <div v-else class="empty-inspector">点击 3D 拓扑节点，在此查看探针参数</div>
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
      
      // 1. Calculate and update satellite positions for this time tick
      await sqliteClient.updateSatellitePositions(simTime.value);
      
      // 2. Fetch assets and weapons to merge as node objects
      const assetsList = await sqliteClient.query<any>("SELECT * FROM assets");
      const weaponsList = await sqliteClient.query<any>("SELECT * FROM weapons");
      

      const mappedAssets = assetsList.map(a => {
        let x = undefined;
        let y = undefined;
        if (a.lat !== null && a.lat !== undefined && a.lat !== 0 &&
            a.lng !== null && a.lng !== undefined && a.lng !== 0) {
          x = ((a.lng - 121.0) / 2.0) * 160;
          y = ((a.lat - 24.0) / 2.0) * 160;
          
          const CLAMP_BOUND = 200;
          x = Math.max(-CLAMP_BOUND, Math.min(CLAMP_BOUND, x));
          y = Math.max(-CLAMP_BOUND, Math.min(CLAMP_BOUND, y));
        }
        return {
          ...a,
          fx: x,
          fy: y,
          fz: a.layer * 150 - 150
        };
      });

      const weaponNodes = weaponsList.map(w => {
        let lat = w.base_lat;
        let lng = w.base_lng;
        // If it's a cyber weapon with 0 coordinates, give it a default red side position
        if (lat === 0 || lng === 0) {
          lat = 24.2;
          lng = 118.5;
        }

        let x = undefined;
        let y = undefined;
        if (lat !== null && lat !== undefined && lat !== 0 &&
            lng !== null && lng !== undefined && lng !== 0) {
          x = ((lng - 121.0) / 2.0) * 160;
          y = ((lat - 24.0) / 2.0) * 160;
          
          const CLAMP_BOUND = 200;
          x = Math.max(-CLAMP_BOUND, Math.min(CLAMP_BOUND, x));
          y = Math.max(-CLAMP_BOUND, Math.min(CLAMP_BOUND, y));
        }
        return {
          id: w.id,
          name: w.name,
          side: 'RED',
          layer: 0, // Ground
          asset_class: 'WEAPON',
          category: w.category,
          kill_type: w.kill_type,
          action_cost: w.action_cost,
          max_range: w.max_range,
          inventory: w.inventory,
          political_risk: w.political_risk,
          lat: lat,
          lng: lng,
          fx: x,
          fy: y,
          fz: -150
        };
      });
      
      assets.value = [...mappedAssets, ...weaponNodes];

      // 3. Fetch active communication windows at this tick
      const linksList = await sqliteClient.query<any>(`
        SELECT * FROM communication_windows 
        WHERE ? BETWEEN window_start AND window_end
      `, [simTime.value]);
      
      const mappedLinks = linksList.map(l => ({
        id: l.id,
        scenario_id: l.scenario_id,
        source: l.source_id,
        target: l.target_id,
        window_start: l.window_start,
        window_end: l.window_end,
        routing_converge_delay: l.routing_converge_delay,
        link_status: l.link_status
      }));

      // 4. Fetch active engagements at this tick to draw links from weapons to targets
      const engagementLinks = await sqliteClient.query<any>(`
        SELECT e.weapon_id as source, a.id as target, 
               'ENGAGEMENT' as link_status
        FROM engagements e
        JOIN communication_windows cw ON e.target_window_id = cw.id
        JOIN assets a ON cw.target_id = a.id OR cw.source_id = a.id
        WHERE e.action_time = ?
        GROUP BY e.id
      `, [simTime.value]);

      links.value = [...mappedLinks, ...engagementLinks];
      
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
    addLog('导入基础场景数据完成！正在进行初始轨道视算...', 'info');
    await sqliteClient.calculateWindows('scen-001');
    addLog('初始轨道视算完成！星地链路已生成。', 'success');
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

.app-container {
  height: 100vh;
  padding: 20px;
  display: flex;
  flex-direction: column;
  box-sizing: border-box;
  overflow: hidden;
}

.app-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 20px;
  padding: 12px 24px;

  .header-left {
    display: flex;
    align-items: center;
    gap: 24px;
    
    .header-logo {
      font-size: 20px;
      font-weight: bold;
    }
  }

  .nav-tabs {
    display: flex;
    gap: 8px;
  }

  .header-right {
    display: flex;
    align-items: center;
    gap: 24px;

    .header-right-item {
      display: flex;
      align-items: center;
      gap: 8px;
    }

    .db-status-container {
      display: flex;
      align-items: center;
      gap: 4px;
    }
  }
}

.tab-btn {
  padding: 6px 12px;
  font-size: 12px;
  border-radius: 4px;
  border: 1px solid rgba(0, 225, 255, 0.15);
  background-color: transparent;
  color: $text-dim;
  font-weight: bold;
  cursor: pointer;
  transition: all 0.3s ease;

  &:hover {
    color: #00e1ff;
  }

  &.active {
    background-color: rgba(0, 225, 255, 0.2);
    border-color: #00e1ff;
    color: #00e1ff;
  }
}

.status-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  display: inline-block;
  
  &.status-green {
    background-color: #10b981;
    box-shadow: 0 0 8px #10b981;
  }
  
  &.status-red {
    background-color: #ef4444;
    box-shadow: 0 0 8px #ef4444;
  }
}

.sandbox-workspace {
  flex: 1;
  display: flex;
  flex-direction: row;
  gap: 20px;
  min-height: 0;
  width: 100%;
  overflow: hidden;
}

.left-sidebar {
  width: 25%;
  display: flex;
  flex-direction: column;
  gap: 20px;
  min-height: 0;
  
  .config-panel {
    flex: none;
  }
  
  .config-form {
    font-size: 12px;
    margin-top: 12px;
    padding-left: 8px;
    padding-right: 8px;
  }
  
  .form-input-full {
    width: 100% !important;
  }
  
  .action-btn-row {
    display: flex;
    gap: 8px;
    
    .flex-btn {
      flex: 1;
    }
  }
  
  .submit-btn {
    width: 100% !important;
    font-weight: bold;
    margin-top: 8px !important;
    margin-left: 0 !important;
  }
  
  .time-slider-container {
    margin-top: 16px;
    padding-left: 8px;
    padding-right: 8px;
    
    .slider-header {
      display: flex;
      justify-content: space-between;
      font-size: 12px;
      margin-bottom: 4px;
      
      .time-progress {
        color: #00e1ff;
      }
    }
  }

  .timeline-panel {
    flex: 1;
    display: flex;
    flex-direction: column;
    min-height: 0;
  }

  .timeline-log-container {
    flex: 1;
    overflow-y: auto;
    background-color: rgba(0, 0, 0, 0.4);
    padding: 16px;
    border-radius: 4px;
    border: 1px solid rgba(0, 225, 255, 0.15);
    
    .log-message {
      font-size: 12px;
      color: $text-dim;
      line-height: 1.375;
    }
    
    .empty-log-message {
      color: $text-dim;
      text-align: center;
      margin-top: 40px;
      font-size: 12px;
    }
  }
}

.center-viewport {
  width: 50%;
  display: flex;
  flex-direction: column;
  min-height: 0;
  position: relative;
  
  .side-tags-row {
    display: flex;
    gap: 8px;
  }
  
  .canvas-container {
    flex: 1;
    background-color: rgba(0, 0, 0, 0.6);
    border-radius: 4px;
    border: 1px solid rgba(0, 225, 255, 0.15);
    position: relative;
    overflow: hidden;
    display: flex;
    flex-direction: column;
    min-height: 0;
    
    .empty-canvas-message {
      flex: 1;
      display: flex;
      align-items: center;
      justify-content: center;
      color: $text-dim;
      font-size: 12px;
    }
  }
}

.right-sidebar {
  width: 25%;
  display: flex;
  flex-direction: column;
  gap: 20px;
  min-height: 0;
  
  .radar-card {
    height: 250px;
    display: flex;
    flex-direction: column;
    min-height: 0;
    
    .small-radar-container {
      flex: 1;
      width: 100%;
      min-height: 150px;
    }
  }
  
  .weapon-assignment-card {
    flex: 1;
    display: flex;
    flex-direction: column;
    min-height: 0;
  }
  
  .inspector-card {
    flex: none;
    height: 220px;
    display: flex;
    flex-direction: column;
    
    .inspector-details {
      flex: 1;
      overflow-y: auto;
      font-size: 12px;
      
      .inspector-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: 12px;
        
        .entity-name {
          font-size: 14px;
          font-weight: bold;
          color: #67e8f9;
        }
      }
      
      .info-grid {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        column-gap: 16px;
        row-gap: 6px;
        
        .grid-col-full {
          grid-column: span 2 / span 2;
        }
      }
      
      .label-dim {
        color: $text-dim;
      }
      
      .value-yellow {
        color: #facc15;
      }
      .value-cyan {
        color: #22d3ee;
      }
      .value-green {
        color: #4ade80;
      }
      .value-red {
        color: #f87171;
      }
      .detected-red {
        color: #f87171;
      }
      .hidden-green {
        color: #4ade80;
      }
      
      .empty-inspector {
        color: $text-dim;
        text-align: center;
        margin-top: 20px;
      }
    }
  }
}

// el-timeline customization
.el-timeline {
  padding-left: 0;
}
.el-timeline-item__content {
  color: #a0aec0;
}

// Element Plus Dark Theme Overrides
.left-sidebar {
  .el-select,
  .el-input,
  .el-input-number {
    --el-fill-color-blank: #0a1128 !important;
    --el-border-color: rgba(0, 225, 255, 0.25) !important;
    --el-border-color-hover: #00e1ff !important;
    --el-text-color-regular: #cbd5e1 !important;
    --el-text-color-placeholder: #475569 !important;
  }
  
  .el-input__wrapper,
  .el-select__wrapper {
    background-color: #0a1128 !important;
    box-shadow: 0 0 0 1px rgba(0, 225, 255, 0.25) inset !important;
    
    .el-input__inner,
    .el-select__placeholder,
    .el-select__selected-item {
      color: #cbd5e1 !important;
    }
  }
  
  .el-input__wrapper.is-focus,
  .el-select__wrapper.is-focus {
    box-shadow: 0 0 0 1px #00e1ff inset !important;
  }

  .el-input-number {
    .el-input-number__increase,
    .el-input-number__decrease {
      background-color: #0b1836 !important;
      border-color: rgba(0, 225, 255, 0.25) !important;
      color: #cbd5e1 !important;
      
      &:hover {
        color: #00e1ff !important;
      }
    }
  }
}

.el-select__dropdown,
.el-select-dropdown {
  background-color: #0a1128 !important;
  border: 1px solid rgba(0, 225, 255, 0.25) !important;
  
  .el-select-dropdown__item {
    color: #cbd5e1 !important;
    background-color: transparent !important;
    
    &.hover,
    &:hover {
      background-color: #0d1b40 !important;
      color: #00e1ff !important;
    }
    
    &.is-selected {
      color: #00e1ff !important;
      font-weight: bold;
      background-color: #102a5c !important;
    }
  }
}
</style>
