<template>
  <div class="aar-panel">
    <!-- Plan Comparison Toolbar -->
    <div class="comparison-toolbar tech-panel">
      <div class="toolbar-header">
        <span>复盘对比方案配置</span>
        <span class="header-subtitle">Plan Comparison Config</span>
      </div>
      <div class="selector-row">
        <div class="selector-item">
          <span class="label-text">对比方案 A (蓝色/折线):</span>
          <el-select v-model="selectedPlanA" placeholder="选择方案 A" size="small" style="width: 250px;" @change="onPlanChange">
            <el-option v-for="p in availablePlans" :key="p.id" :label="p.name" :value="p.id" />
          </el-select>
        </div>
        <div class="selector-item">
          <span class="label-text">对比方案 B (红色/柱状):</span>
          <el-select v-model="selectedPlanB" placeholder="选择方案 B" size="small" style="width: 250px;" @change="onPlanChange">
            <el-option v-for="p in availablePlans" :key="p.id" :label="p.name" :value="p.id" />
          </el-select>
        </div>
      </div>
    </div>

    <!-- Summary Cards Row (Displays Stats for Plan A) -->
    <div class="summary-cards-row">
      <div class="summary-card tech-panel bg-gradient-red">
        <div class="card-title">总计摧毁蓝方资产 (方案 A)</div>
        <div class="digital-font card-value text-red">{{ summary.destroyedCount }} 个</div>
      </div>
      <div class="summary-card tech-panel bg-gradient-cyan">
        <div class="card-title">总计阻断成功率 (方案 A)</div>
        <div class="digital-font card-value text-cyan">{{ summary.blockRate }}%</div>
      </div>
      <div class="summary-card tech-panel bg-gradient-green">
        <div class="card-title">红方累计弹药耗费 (方案 A)</div>
        <div class="digital-font card-value text-green">${{ formatNumber(summary.totalCost) }}</div>
      </div>
      <div class="summary-card tech-panel bg-gradient-yellow">
        <div class="card-title">达成网络自愈时延 (方案 A)</div>
        <div class="digital-font card-value text-yellow">{{ summary.totalDelay }} 秒</div>
      </div>
    </div>

    <!-- Charts Container Row -->
    <div class="charts-row">
      <!-- Left: Radar Chart -->
      <div class="chart-col-5 tech-panel">
        <div class="panel-header">
          <span>兵棋推演多维方案效能对比</span>
          <span class="header-subtitle">Plan Radar Analysis</span>
        </div>
        <div ref="radarChartRef" class="chart-container"></div>
      </div>

      <!-- Right: Line + Bar Combo Chart -->
      <div class="chart-col-7 tech-panel">
        <div class="panel-header">
          <span>时序链路压制率 vs 红方资源消耗 对比</span>
          <span class="header-subtitle">Timeline Performance & Budget Comparison</span>
        </div>
        <div ref="lineBarChartRef" class="chart-container"></div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount, nextTick, watch } from 'vue';
import * as echarts from 'echarts';
import { sqliteClient } from '../db/sqlite-client';

const radarChartRef = ref<HTMLDivElement | null>(null);
const lineBarChartRef = ref<HTMLDivElement | null>(null);

let radarChart: echarts.ECharts | null = null;
let lineBarChart: echarts.ECharts | null = null;

// Plan selection state
const availablePlans = ref<any[]>([]);
const selectedPlanA = ref('plan-001');
const selectedPlanB = ref('plan-mock-kinetic');

// Mock Comparison Plan
const mockPlan = {
  id: 'plan-mock-kinetic',
  name: '参考对比组: 强力动能摧毁方案',
  intensity_level: 'HIGH',
  total_cost: 320000.0,
  total_delay_achieved: 12000,
  nodes_destroyed: 5,
  final_score: 63.75,
  timeline_collapse_ratios: JSON.stringify([0, 10, 20, 30, 40, 50, 60, 70, 80, 85, 90, 95, 95, 95, 95, 95, 95, 95, 95, 95, 95, 95, 95, 95, 95, 95]),
  timeline_cumulative_costs: JSON.stringify([0, 12000, 24000, 36000, 60000, 96000, 144000, 180000, 216000, 240000, 260000, 280000, 300000, 320000, 320000, 320000, 320000, 320000, 320000, 320000, 320000, 320000, 320000, 320000, 320000, 320000])
};

// Summary stats (Displays stats for Plan A)
const summary = ref({
  destroyedCount: 0,
  blockRate: 0,
  totalCost: 0,
  totalDelay: 0
});

// Helper formatting method
const formatNumber = (num: number) => {
  return num.toLocaleString();
};

const onPlanChange = () => {
  loadAndAggregateData();
};

// Retrieve timeline arrays for a given plan (dynamically queries if active/plan-001, otherwise parses stored JSON)
const loadPlanTimeline = async (plan: any) => {
  if (plan.id !== 'plan-001' && plan.timeline_collapse_ratios && plan.timeline_cumulative_costs) {
    try {
      return {
        collapseRatios: JSON.parse(plan.timeline_collapse_ratios),
        cumulativeCosts: JSON.parse(plan.timeline_cumulative_costs)
      };
    } catch (e) {
      console.error("Failed to parse timeline JSON", e);
    }
  }

  // Fallback/Dynamic calculation (primarily for active plan-001)
  const collapseRatios: number[] = [];
  const cumulativeCosts: number[] = [];
  for (let m = 0; m <= 50; m += 2) {
    const t = 1781683200 + m * 60;
    
    // Collapse ratio at this minute
    const linksRes = await sqliteClient.query<any>(`
      SELECT COUNT(*) as total, 
             SUM(CASE WHEN link_status IN ('JAMMED', 'DESTROYED') THEN 1 ELSE 0 END) as blocked 
      FROM communication_windows 
      WHERE ? BETWEEN window_start AND window_end
    `, [t]);
    const totalCount = linksRes[0]?.total || 0;
    const blockedCount = linksRes[0]?.blocked || 0;
    const ratio = totalCount > 0 ? Math.round((blockedCount / totalCount) * 100) : 0;
    collapseRatios.push(ratio);

    // Cumulative cost up to this minute
    const costRes = await sqliteClient.query<any>(`
      SELECT SUM(w.action_cost) as total_cost 
      FROM engagements e
      JOIN weapons w ON e.weapon_id = w.id
      WHERE e.action_time <= ?
    `, [t]);
    const cost = costRes[0]?.total_cost || 0;
    cumulativeCosts.push(cost);
  }
  return { collapseRatios, cumulativeCosts };
};

// Aggregates data from SQLite Wasm and renders charts
const loadAndAggregateData = async () => {
  if (!sqliteClient.isInitialized.value) {
    return;
  }
  try {
    // 1. Fetch all available plans in DB
    const plansList = await sqliteClient.query<any>("SELECT * FROM tactical_plans");
    availablePlans.value = [
      ...plansList.map(p => ({
        id: p.id,
        name: p.id === 'plan-001' ? '当前实时推演方案' : p.name,
        ...p
      })),
      mockPlan
    ];

    // Find currently selected plan objects
    const planAObj = availablePlans.value.find(p => p.id === selectedPlanA.value) || availablePlans.value[0];
    const planBObj = availablePlans.value.find(p => p.id === selectedPlanB.value) || mockPlan;

    // Update Summary Stats for Plan A
    summary.value.totalCost = planAObj.total_cost || 0;
    summary.value.totalDelay = planAObj.total_delay_achieved || 0;
    summary.value.destroyedCount = planAObj.nodes_destroyed || 0;

    // Calculate final block rate for Plan A
    if (planAObj.id === 'plan-001') {
      const totalLinks = await sqliteClient.query<any>("SELECT COUNT(*) as cnt FROM communication_windows");
      const blockedLinks = await sqliteClient.query<any>("SELECT COUNT(*) as cnt FROM communication_windows WHERE link_status IN ('JAMMED', 'DESTROYED')");
      const tot = totalLinks[0]?.cnt || 0;
      const blk = blockedLinks[0]?.cnt || 0;
      summary.value.blockRate = tot > 0 ? Math.round((blk / tot) * 100) : 0;
    } else {
      const ratios = planAObj.timeline_collapse_ratios ? JSON.parse(planAObj.timeline_collapse_ratios) : [];
      summary.value.blockRate = ratios.length > 0 ? ratios[ratios.length - 1] : 0;
    }

    // Dynamic scores for Plan A
    const blockScoreA = summary.value.blockRate;
    const controlScoreA = Math.max(30, Math.round(100 - (summary.value.totalCost / 200000) * 50));
    const costEfficiencyA = Math.min(95, Math.round((summary.value.totalDelay / (summary.value.totalCost + 100)) * 6000));
    const selfInterferenceA = Math.max(20, Math.round(100 - (summary.value.totalCost > 50000 ? 40 : 15)));
    const planAScores = [blockScoreA, controlScoreA, costEfficiencyA, selfInterferenceA];

    // Dynamic scores for Plan B
    let blockRateB = 0;
    if (planBObj.id === 'plan-mock-kinetic') {
      blockRateB = 95;
    } else if (planBObj.id === 'plan-001') {
      const totalLinks = await sqliteClient.query<any>("SELECT COUNT(*) as cnt FROM communication_windows");
      const blockedLinks = await sqliteClient.query<any>("SELECT COUNT(*) as cnt FROM communication_windows WHERE link_status IN ('JAMMED', 'DESTROYED')");
      const tot = totalLinks[0]?.cnt || 0;
      const blk = blockedLinks[0]?.cnt || 0;
      blockRateB = tot > 0 ? Math.round((blk / tot) * 100) : 0;
    } else {
      const ratios = planBObj.timeline_collapse_ratios ? JSON.parse(planBObj.timeline_collapse_ratios) : [];
      blockRateB = ratios.length > 0 ? ratios[ratios.length - 1] : 0;
    }

    const blockScoreB = blockRateB;
    const controlScoreB = Math.max(30, Math.round(100 - ((planBObj.total_cost || 0) / 200000) * 50));
    const costEfficiencyB = Math.min(95, Math.round(((planBObj.total_delay_achieved || 0) / ((planBObj.total_cost || 0) + 100)) * 6000));
    const selfInterferenceB = Math.max(20, Math.round(100 - ((planBObj.total_cost || 0) > 50000 ? 40 : 15)));
    const planBScores = [blockScoreB, controlScoreB, costEfficiencyB, selfInterferenceB];

    // 2. Fetch Time Series data for both plans
    const { collapseRatios: collapseA, cumulativeCosts: costA } = await loadPlanTimeline(planAObj);
    const { collapseRatios: collapseB, cumulativeCosts: costB } = await loadPlanTimeline(planBObj);

    const timelineLabels: string[] = [];
    for (let m = 0; m <= 50; m += 2) {
      timelineLabels.push(`${m} min`);
    }

    renderRadar(planAScores, planBScores, planAObj.name, planBObj.name);
    renderLineBar(timelineLabels, collapseA, costA, collapseB, costB, planAObj.name, planBObj.name);
  } catch (error) {
    console.error('Error aggregating AAR data:', error);
  }
};

const renderRadar = (planA: number[], planB: number[], nameA: string, nameB: string) => {
  if (!radarChartRef.value) return;
  let chartInstance = echarts.getInstanceByDom(radarChartRef.value);
  if (!chartInstance) {
    chartInstance = echarts.init(radarChartRef.value, 'dark');
  }

  const option = {
    backgroundColor: 'transparent',
    color: ['#00e1ff', '#ff2a5f'],
    tooltip: {
      trigger: 'item'
    },
    legend: {
      data: [nameA, nameB],
      textStyle: { color: '#c3d1e6', fontSize: 10 },
      bottom: 5
    },
    radar: {
      indicator: [
        { name: '链路阻断率 (Block Rate)', max: 100 },
        { name: '冲突控制度 (Conflict Control)', max: 100 },
        { name: '效费比 (Cost Efficiency)', max: 100 },
        { name: '己方自扰度 (Self Interference)', max: 100 }
      ],
      shape: 'polygon',
      splitNumber: 4,
      axisName: {
        color: '#c3d1e6',
        fontSize: 10
      },
      splitLine: {
        lineStyle: {
          color: 'rgba(0, 225, 255, 0.1)'
        }
      },
      splitArea: {
        show: false
      },
      axisLine: {
        lineStyle: {
          color: 'rgba(0, 225, 255, 0.1)'
        }
      }
    },
    series: [
      {
        name: '方案效能对比',
        type: 'radar',
        data: [
          {
            value: planA,
            name: nameA,
            areaStyle: {
              color: 'rgba(0, 225, 255, 0.2)'
            }
          },
          {
            value: planB,
            name: nameB,
            areaStyle: {
              color: 'rgba(255, 42, 95, 0.15)'
            }
          }
        ]
      }
    ]
  };

  chartInstance.setOption(option, true);
};

const renderLineBar = (
  labels: string[],
  collapseA: number[],
  costA: number[],
  collapseB: number[],
  costB: number[],
  nameA: string,
  nameB: string
) => {
  if (!lineBarChartRef.value) return;
  let chartInstance = echarts.getInstanceByDom(lineBarChartRef.value);
  if (!chartInstance) {
    chartInstance = echarts.init(lineBarChartRef.value, 'dark');
  }

  const option = {
    backgroundColor: 'transparent',
    tooltip: {
      trigger: 'axis',
      axisPointer: {
        type: 'cross',
        crossStyle: {
          color: '#999'
        }
      }
    },
    legend: {
      data: [`${nameA}: 链路阻断率 (%)`, `${nameB}: 链路阻断率 (%)`, `${nameA}: 资源消耗 ($)`, `${nameB}: 资源消耗 ($)`],
      textStyle: { color: '#c3d1e6', fontSize: 9 },
      bottom: 0
    },
    grid: {
      top: '15%',
      left: '10%',
      right: '10%',
      bottom: '18%'
    },
    xAxis: [
      {
        type: 'category',
        data: labels,
        axisPointer: {
          type: 'shadow'
        },
        axisLine: { lineStyle: { color: 'rgba(0, 225, 255, 0.2)' } },
        axisLabel: { color: '#c3d1e6', fontSize: 9 }
      }
    ],
    yAxis: [
      {
        type: 'value',
        name: '链路阻断率',
        min: 0,
        max: 100,
        interval: 20,
        axisLabel: {
          formatter: '{value} %',
          color: '#c3d1e6',
          fontSize: 9
        },
        axisLine: { lineStyle: { color: 'rgba(0, 225, 255, 0.2)' } },
        splitLine: { lineStyle: { color: 'rgba(255, 255, 255, 0.05)' } }
      },
      {
        type: 'value',
        name: '资源消耗 ($)',
        axisLabel: {
          formatter: '${value}',
          color: '#c3d1e6',
          fontSize: 9
        },
        axisLine: { lineStyle: { color: 'rgba(0, 225, 255, 0.2)' } },
        splitLine: { show: false }
      }
    ],
    series: [
      {
        name: `${nameA}: 资源消耗 ($)`,
        type: 'bar',
        yAxisIndex: 1,
        data: costA,
        itemStyle: {
          color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
            { offset: 0, color: '#10b981' },
            { offset: 1, color: '#047857' }
          ])
        }
      },
      {
        name: `${nameB}: 资源消耗 ($)`,
        type: 'bar',
        yAxisIndex: 1,
        data: costB,
        itemStyle: {
          color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
            { offset: 0, color: '#f43f5e' },
            { offset: 1, color: '#be123c' }
          ])
        }
      },
      {
        name: `${nameA}: 链路阻断率 (%)`,
        type: 'line',
        data: collapseA,
        itemStyle: {
          color: '#00e1ff'
        },
        lineStyle: {
          width: 2.5,
          shadowColor: 'rgba(0, 225, 255, 0.5)',
          shadowBlur: 5
        }
      },
      {
        name: `${nameB}: 链路阻断率 (%)`,
        type: 'line',
        data: collapseB,
        itemStyle: {
          color: '#ff2a5f'
        },
        lineStyle: {
          width: 2.5,
          shadowColor: 'rgba(255, 42, 95, 0.5)',
          shadowBlur: 5
        }
      }
    ]
  };

  chartInstance.setOption(option, true);
};

onMounted(() => {
  nextTick(() => {
    loadAndAggregateData();
  });
});

watch(() => sqliteClient.isInitialized.value, (init) => {
  if (init) {
    loadAndAggregateData();
  }
});

onBeforeUnmount(() => {
  if (radarChartRef.value) {
    const instance = echarts.getInstanceByDom(radarChartRef.value);
    if (instance) instance.dispose();
  }
  if (lineBarChartRef.value) {
    const instance = echarts.getInstanceByDom(lineBarChartRef.value);
    if (instance) instance.dispose();
  }
});
</script>

<style scoped lang="scss">
@import "../styles/theme.scss";

.aar-panel {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 20px;
  min-height: 0;
  background-color: rgba(15, 23, 42, 0.2); // bg-slate-950/20
  box-sizing: border-box;
  overflow: hidden;
}

.comparison-toolbar {
  padding: 12px 16px;
  flex: none;
  display: flex;
  flex-direction: column;
  gap: 8px;
  
  .toolbar-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    border-bottom: 1px solid rgba(0, 225, 255, 0.1);
    padding-bottom: 4px;
    
    span {
      font-size: 14px;
      font-weight: bold;
      color: #00e1ff;
    }
  }
  
  .selector-row {
    display: flex;
    gap: 32px;
    
    .selector-item {
      display: flex;
      align-items: center;
      gap: 12px;
      
      .label-text {
        font-size: 12px;
        color: $text-dim;
      }
    }
  }
}

.summary-cards-row {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 16px;
  flex: none;
}

.tech-panel {
  border-radius: 4px;
  background-color: rgba(8, 12, 22, 0.5);
  box-shadow: 0 0 10px rgba(0, 225, 255, 0.03);
  border: 1px solid rgba(0, 225, 255, 0.1);
}

.summary-card {
  padding: 12px 16px;
  display: flex;
  flex-direction: column;
  justify-content: center;
}

.bg-gradient-red,
.bg-gradient-cyan,
.bg-gradient-green,
.bg-gradient-yellow {
  background: linear-gradient(to right, rgba(13, 27, 49, 0.4), rgba(15, 23, 42, 0.4));
}

.card-title {
  font-size: 10px;
  color: $text-dim;
}

.card-value {
  font-size: 24px; // text-2xl
  font-weight: bold;
  margin-top: 4px; // mt-1

  &.text-red {
    color: #ef4444; // text-red-500
  }

  &.text-cyan {
    color: #22d3ee; // text-cyan-400
  }

  &.text-green {
    color: #4ade80; // text-green-400
  }

  &.text-yellow {
    color: #eab308; // text-yellow-500
  }
}

.charts-row {
  flex: 1;
  display: grid;
  grid-template-columns: repeat(12, minmax(0, 1fr));
  gap: 20px;
  min-height: 0;
}

.chart-col-5 {
  grid-column: span 5 / span 5;
  display: flex;
  flex-direction: column;
  min-height: 0;
}

.chart-col-7 {
  grid-column: span 7 / span 7;
  display: flex;
  flex-direction: column;
  min-height: 0;
}

.panel-header {
  flex: none;
}

.header-subtitle {
  font-size: 12px;
  color: $text-dim;
}

.chart-container {
  flex: 1;
  width: 100%;
  min-height: 0;
}
</style>
