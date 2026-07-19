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
          <el-select v-model="selectedPlanA" placeholder="选择方案 A" size="small" style="width: 250px;"
            @change="onPlanChange">
            <el-option v-for="p in availablePlans.filter(item => item.id !== selectedPlanB)" :key="p.id" :label="p.name"
              :value="p.id" />
          </el-select>
        </div>
        <div class="selector-item">
          <span class="label-text">对比方案 B (红色/柱状):</span>
          <el-select v-model="selectedPlanB" placeholder="选择对比方案" size="small" style="width: 250px;"
            @change="onPlanChange">
            <el-option label="无 (不进行对比)" value="" />
            <el-option v-for="p in availablePlans.filter(item => item.id !== selectedPlanA)" :key="p.id" :label="p.name"
              :value="p.id" />
          </el-select>
        </div>
      </div>
    </div>

    <!-- Summary Cards Row (Displays Stats) -->
    <div class="summary-cards-row">
      <!-- Card 1: Destroyed Nodes -->
      <div class="summary-card tech-panel bg-gradient-red">
        <div class="card-title">总计摧毁蓝方资产</div>
        <div class="card-value-container">
          <div class="card-value-row">
            <span class="digital-font card-value text-cyan">{{ summaryA.destroyedCount }}</span>
            <span class="value-unit" v-if="!hasPlanB"> 个</span>
            <span class="value-divider" v-if="hasPlanB"> / </span>
            <span class="digital-font card-value text-red" v-if="hasPlanB">{{ summaryB.destroyedCount }}</span>
            <span class="value-unit" v-if="hasPlanB"> 个</span>
          </div>
          <div class="card-sub-labels" v-if="hasPlanB">
            <span class="sub-label text-cyan-dim">方案 A</span>
            <span class="sub-label text-red-dim">方案 B</span>
          </div>
        </div>
      </div>

      <!-- Card 2: Block Rate -->
      <div class="summary-card tech-panel bg-gradient-cyan">
        <div class="card-title">总计阻断成功率</div>
        <div class="card-value-container">
          <div class="card-value-row">
            <span class="digital-font card-value text-cyan">{{ summaryA.blockRate }}</span>
            <span class="value-unit" v-if="!hasPlanB">%</span>
            <span class="value-divider" v-if="hasPlanB"> / </span>
            <span class="digital-font card-value text-red" v-if="hasPlanB">{{ summaryB.blockRate }}</span>
            <span class="value-unit" v-if="hasPlanB">%</span>
          </div>
          <div class="card-sub-labels" v-if="hasPlanB">
            <span class="sub-label text-cyan-dim">方案 A</span>
            <span class="sub-label text-red-dim">方案 B</span>
          </div>
        </div>
      </div>

      <!-- Card 3: Total Cost -->
      <div class="summary-card tech-panel bg-gradient-green">
        <div class="card-title">红方累计弹药耗费</div>
        <div class="card-value-container">
          <div class="card-value-row">
            <span class="digital-font card-value text-cyan">${{ formatNumber(summaryA.totalCost) }}</span>
            <span class="value-divider" v-if="hasPlanB"> / </span>
            <span class="digital-font card-value text-red" v-if="hasPlanB">${{ formatNumber(summaryB.totalCost)
              }}</span>
          </div>
          <div class="card-sub-labels" v-if="hasPlanB">
            <span class="sub-label text-cyan-dim">方案 A</span>
            <span class="sub-label text-red-dim">方案 B</span>
          </div>
        </div>
      </div>

      <!-- Card 4: Total Delay -->
      <div class="summary-card tech-panel bg-gradient-yellow">
        <div class="card-title">达成网络自愈时延</div>
        <div class="card-value-container">
          <div class="card-value-row">
            <span class="digital-font card-value text-cyan">{{ summaryA.totalDelay }}</span>
            <span class="value-unit" v-if="!hasPlanB"> 秒</span>
            <span class="value-divider" v-if="hasPlanB"> / </span>
            <span class="digital-font card-value text-red" v-if="hasPlanB">{{ summaryB.totalDelay }}</span>
            <span class="value-unit" v-if="hasPlanB"> 秒</span>
          </div>
          <div class="card-sub-labels" v-if="hasPlanB">
            <span class="sub-label text-cyan-dim">方案 A</span>
            <span class="sub-label text-red-dim">方案 B</span>
          </div>
        </div>
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
import { ref, computed, onMounted, onBeforeUnmount, nextTick, watch } from 'vue';
import * as echarts from 'echarts';
import { sqliteClient } from '../db/sqlite-client';

const radarChartRef = ref<HTMLDivElement | null>(null);
const lineBarChartRef = ref<HTMLDivElement | null>(null);

// Plan selection state
const availablePlans = ref<any[]>([]);
const selectedPlanA = ref('');
const selectedPlanB = ref(''); // Default to no comparison plan

const hasPlanB = computed(() => !!selectedPlanB.value);

// Summary stats for both plans
const summaryA = ref({
  destroyedCount: 0,
  blockRate: 0,
  totalCost: 0,
  totalDelay: 0
});

const summaryB = ref({
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
    // 1. Fetch all available plans in DB (excluding active plan-001)
    const plansList = await sqliteClient.query<any>("SELECT * FROM tactical_plans WHERE id != 'plan-001'");
    availablePlans.value = plansList;

    // If selectedPlanA is no longer in the list (or invalid), default to the first plan if available
    if (!availablePlans.value.some(p => p.id === selectedPlanA.value) && availablePlans.value.length > 0) {
      selectedPlanA.value = availablePlans.value[0].id;
    }

    // Find currently selected plan objects
    const planAObj = availablePlans.value.find(p => p.id === selectedPlanA.value);
    const planBObj = selectedPlanB.value ? availablePlans.value.find(p => p.id === selectedPlanB.value) : null;

    if (!planAObj) {
      // Reset summary values
      summaryA.value = { destroyedCount: 0, blockRate: 0, totalCost: 0, totalDelay: 0 };
      summaryB.value = { destroyedCount: 0, blockRate: 0, totalCost: 0, totalDelay: 0 };
      
      // Clear charts if they exist
      if (radarChartRef.value) {
        const instance = echarts.getInstanceByDom(radarChartRef.value);
        if (instance) instance.clear();
      }
      if (lineBarChartRef.value) {
        const instance = echarts.getInstanceByDom(lineBarChartRef.value);
        if (instance) instance.clear();
      }
      return;
    }

    // Update Summary Stats for Plan A
    summaryA.value.totalCost = planAObj.total_cost || 0;
    summaryA.value.totalDelay = planAObj.total_delay_achieved || 0;
    summaryA.value.destroyedCount = planAObj.nodes_destroyed || 0;

    // Calculate final block rate for Plan A
    if (planAObj.id === 'plan-001') {
      const totalLinks = await sqliteClient.query<any>("SELECT COUNT(*) as cnt FROM communication_windows");
      const blockedLinks = await sqliteClient.query<any>("SELECT COUNT(*) as cnt FROM communication_windows WHERE link_status IN ('JAMMED', 'DESTROYED')");
      const tot = totalLinks[0]?.cnt || 0;
      const blk = blockedLinks[0]?.cnt || 0;
      summaryA.value.blockRate = tot > 0 ? Math.round((blk / tot) * 100) : 0;
    } else {
      const ratios = planAObj.timeline_collapse_ratios ? JSON.parse(planAObj.timeline_collapse_ratios) : [];
      summaryA.value.blockRate = ratios.length > 0 ? ratios[ratios.length - 1] : 0;
    }

    // Dynamic scores for Plan A
    const blockScoreA = summaryA.value.blockRate;
    const controlScoreA = Math.max(30, Math.round(100 - (summaryA.value.totalCost / 200000) * 50));
    const costEfficiencyA = Math.min(95, Math.round((summaryA.value.totalDelay / (summaryA.value.totalCost + 100)) * 6000));
    const selfInterferenceA = Math.max(20, Math.round(100 - (summaryA.value.totalCost > 50000 ? 40 : 15)));
    const planAScores = [blockScoreA, controlScoreA, costEfficiencyA, selfInterferenceA];

    // Dynamic scores for Plan B (if selected)
    let planBScores: number[] = [];
    if (planBObj) {
      summaryB.value.totalCost = planBObj.total_cost || 0;
      summaryB.value.totalDelay = planBObj.total_delay_achieved || 0;
      summaryB.value.destroyedCount = planBObj.nodes_destroyed || 0;

      if (planBObj.id === 'plan-001') {
        const totalLinks = await sqliteClient.query<any>("SELECT COUNT(*) as cnt FROM communication_windows");
        const blockedLinks = await sqliteClient.query<any>("SELECT COUNT(*) as cnt FROM communication_windows WHERE link_status IN ('JAMMED', 'DESTROYED')");
        const tot = totalLinks[0]?.cnt || 0;
        const blk = blockedLinks[0]?.cnt || 0;
        summaryB.value.blockRate = tot > 0 ? Math.round((blk / tot) * 100) : 0;
      } else {
        const ratios = planBObj.timeline_collapse_ratios ? JSON.parse(planBObj.timeline_collapse_ratios) : [];
        summaryB.value.blockRate = ratios.length > 0 ? ratios[ratios.length - 1] : 0;
      }

      const blockScoreB = summaryB.value.blockRate;
      const controlScoreB = Math.max(30, Math.round(100 - (summaryB.value.totalCost / 200000) * 50));
      const costEfficiencyB = Math.min(95, Math.round((summaryB.value.totalDelay / (summaryB.value.totalCost + 100)) * 6000));
      const selfInterferenceB = Math.max(20, Math.round(100 - (summaryB.value.totalCost > 50000 ? 40 : 15)));
      planBScores = [blockScoreB, controlScoreB, costEfficiencyB, selfInterferenceB];
    }

    // 2. Fetch Time Series data for both plans
    const { collapseRatios: collapseA, cumulativeCosts: costA } = await loadPlanTimeline(planAObj);
    const { collapseRatios: collapseB, cumulativeCosts: costB } = planBObj
      ? await loadPlanTimeline(planBObj)
      : { collapseRatios: [], cumulativeCosts: [] };

    const timelineLabels: string[] = [];
    for (let m = 0; m <= 50; m += 2) {
      timelineLabels.push(`${m} min`);
    }

    renderRadar(planAScores, planBScores, planAObj.name, planBObj ? planBObj.name : '');
    renderLineBar(timelineLabels, collapseA, costA, collapseB, costB, planAObj.name, planBObj ? planBObj.name : '');
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

  const seriesData: any[] = [
    {
      value: planA,
      name: nameA,
      areaStyle: {
        color: 'rgba(0, 225, 255, 0.2)'
      }
    }
  ];

  if (planB && planB.length > 0 && nameB) {
    seriesData.push({
      value: planB,
      name: nameB,
      areaStyle: {
        color: 'rgba(255, 42, 95, 0.15)'
      }
    });
  }

  const legendData = planB && planB.length > 0 && nameB ? [nameA, nameB] : [nameA];

  const option = {
    backgroundColor: 'transparent',
    color: ['#00e1ff', '#ff2a5f'],
    tooltip: {
      trigger: 'item'
    },
    legend: {
      data: legendData,
      textStyle: { color: '#c3d1e6', fontSize: 10 },
      bottom: 5
    },
    radar: {
      indicator: [
        { name: '链路阻断率 (Block Rate)', max: 100 },
        { name: '冲突控制度 (Conflict Control)', max: 100 },
        { name: '效费性价比 (Cost Efficiency)', max: 100 },
        { name: '红方自扰度 (Self Interference)', max: 100 }
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
        data: seriesData
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

  const seriesData: any[] = [
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
    }
  ];

  const legendData = [
    `${nameA}: 链路阻断率 (%)`,
    `${nameA}: 资源消耗 ($)`
  ];

  if (collapseB && collapseB.length > 0 && costB && costB.length > 0 && nameB) {
    seriesData.push({
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
    });

    seriesData.push({
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
    });

    legendData.push(`${nameB}: 链路阻断率 (%)`);
    legendData.push(`${nameB}: 资源消耗 ($)`);
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
      data: legendData,
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
    series: seriesData
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

.card-value-container {
  display: flex;
  flex-direction: column;
  margin-top: 4px;
}

.card-value-row {
  display: flex;
  align-items: baseline;
}

.value-divider {
  font-size: 16px;
  color: #475569;
  margin-left: 8px;
  margin-right: 8px;
}

.value-unit {
  font-size: 12px;
  color: $text-dim;
  margin-left: 2px;
}

.card-sub-labels {
  display: flex;
  justify-content: space-between;
  margin-top: 2px;
  font-size: 9px;

  .text-cyan-dim {
    color: rgba(34, 211, 238, 0.7);
  }

  .text-red-dim {
    color: rgba(255, 42, 95, 0.7);
  }
}

.card-value {
  font-size: 24px; // text-2xl
  font-weight: bold;

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
