<template>
  <div class="aar-panel flex-1 flex flex-col gap-5 min-h-0 bg-slate-950/20 box-border overflow-hidden">
    <!-- Summary Cards Row -->
    <div class="grid grid-cols-4 gap-4 flex-none">
      <div class="summary-card tech-panel bg-gradient-to-r from-blue-950/40 to-slate-900/40">
        <div class="text-[10px] text-dim">总计摧毁蓝方资产</div>
        <div class="digital-font text-2xl text-red-500 font-bold mt-1">{{ summary.destroyedCount }} 个</div>
      </div>
      <div class="summary-card tech-panel bg-gradient-to-r from-blue-950/40 to-slate-900/40">
        <div class="text-[10px] text-dim">总计阻断成功率</div>
        <div class="digital-font text-2xl text-cyan-400 font-bold mt-1">{{ summary.blockRate }}%</div>
      </div>
      <div class="summary-card tech-panel bg-gradient-to-r from-blue-950/40 to-slate-900/40">
        <div class="text-[10px] text-dim">红方累计弹药耗费</div>
        <div class="digital-font text-2xl text-green-400 font-bold mt-1">${{ formatNumber(summary.totalCost) }}</div>
      </div>
      <div class="summary-card tech-panel bg-gradient-to-r from-blue-950/40 to-slate-900/40">
        <div class="text-[10px] text-dim">达成网络自愈时延</div>
        <div class="digital-font text-2xl text-yellow-500 font-bold mt-1">{{ summary.totalDelay }} 秒</div>
      </div>
    </div>

    <!-- Charts Container Row -->
    <div class="flex-1 grid grid-cols-12 gap-5 min-h-0">
      <!-- Left: Radar Chart (Col Span 5) -->
      <div class="col-span-5 tech-panel flex flex-col min-h-0">
        <div class="panel-header flex-none">
          <span>兵棋推演多维方案效能对比</span>
          <span class="text-xs text-dim">Plan Radar Analysis</span>
        </div>
        <div ref="radarChartRef" class="flex-1 w-full min-h-0"></div>
      </div>

      <!-- Right: Line + Bar Combo Chart (Col Span 7) -->
      <div class="col-span-7 tech-panel flex flex-col min-h-0">
        <div class="panel-header flex-none">
          <span>时序链路压制率 vs 红方资源消耗</span>
          <span class="text-xs text-dim">Timeline Performance & Budget</span>
        </div>
        <div ref="lineBarChartRef" class="flex-1 w-full min-h-0"></div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount, nextTick } from 'vue';
import * as echarts from 'echarts';
import { sqliteClient } from '../db/sqlite-client';

const radarChartRef = ref<HTMLDivElement | null>(null);
const lineBarChartRef = ref<HTMLDivElement | null>(null);

let radarChart: echarts.ECharts | null = null;
let lineBarChart: echarts.ECharts | null = null;

// Summary stats
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

// Aggregates data from SQLite Wasm and renders charts
const loadAndAggregateData = async () => {
  try {
    // 1. Fetch current plan performance metrics
    const plans = await sqliteClient.query<any>("SELECT * FROM tactical_plans WHERE id = 'plan-001'");
    let planA = { total_cost: 0, total_delay_achieved: 0, nodes_destroyed: 0 };
    if (plans.length > 0) {
      planA = plans[0];
      summary.value.totalCost = planA.total_cost;
      summary.value.totalDelay = planA.total_delay_achieved;
      summary.value.destroyedCount = planA.nodes_destroyed;
    }

    // Compute blocked rate
    const totalLinks = await sqliteClient.query<any>("SELECT COUNT(*) as cnt FROM communication_windows");
    const blockedLinks = await sqliteClient.query<any>("SELECT COUNT(*) as cnt FROM communication_windows WHERE link_status IN ('JAMMED', 'DESTROYED')");
    const tot = totalLinks[0]?.cnt || 0;
    const blk = blockedLinks[0]?.cnt || 0;
    summary.value.blockRate = tot > 0 ? Math.round((blk / tot) * 100) : 0;

    // Calculate dynamic radar scores for Plan A (EW/Cyber Plan) based on current DB state
    const blockScore = summary.value.blockRate;
    const controlScore = Math.max(30, Math.round(100 - (summary.value.totalCost / 200000) * 50)); 
    const costEfficiency = Math.min(95, Math.round((summary.value.totalDelay / (summary.value.totalCost + 100)) * 6000));
    const selfInterference = Math.max(20, Math.round(100 - (summary.value.totalCost > 50000 ? 40 : 15)));

    const planAScores = [blockScore, controlScore, costEfficiency, selfInterference];
    
    // Plan B (Mocked Kinetic missile strategy as comparison)
    const planBScores = [95, 30, 45, 85];

    // 2. Fetch Time Series data (Collapse % and cumulative cost per minute)
    const timelineLabels: string[] = [];
    const collapseRatios: number[] = [];
    const cumulativeCosts: number[] = [];

    // Loop through 0 to 50 minutes of simulation
    for (let m = 0; m <= 50; m += 2) { // step by 2 minutes for smoother rendering speed
      const t = 1781683200 + m * 60;
      timelineLabels.push(`${m} min`);

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

    renderRadar(planAScores, planBScores);
    renderLineBar(timelineLabels, collapseRatios, cumulativeCosts);
  } catch (error) {
    console.error('Error aggregating AAR data:', error);
  }
};

const renderRadar = (planA: number[], planB: number[]) => {
  if (!radarChartRef.value) return;
  if (!radarChart) {
    radarChart = echarts.init(radarChartRef.value, 'dark');
  }

  const option = {
    backgroundColor: 'transparent',
    color: ['#00e1ff', '#ff2a5f'],
    tooltip: {
      trigger: 'item'
    },
    legend: {
      data: ['方案一: 软压制网电干扰', '方案二: 强力动能摧毁'],
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
        data: [
          {
            value: planA,
            name: '方案一: 软压制网电干扰',
            areaStyle: {
              color: 'rgba(0, 225, 255, 0.2)'
            }
          },
          {
            value: planB,
            name: '方案二: 强力动能摧毁',
            areaStyle: {
              color: 'rgba(255, 42, 95, 0.15)'
            }
          }
        ]
      }
    ]
  };

  radarChart.setOption(option);
};

const renderLineBar = (labels: string[], collapse: number[], cost: number[]) => {
  if (!lineBarChartRef.value) return;
  if (!lineBarChart) {
    lineBarChart = echarts.init(lineBarChartRef.value, 'dark');
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
      data: ['蓝方带宽瘫痪比例 (%)', '红方资源累计消耗 ($)'],
      textStyle: { color: '#c3d1e6', fontSize: 10 },
      bottom: 5
    },
    grid: {
      top: '15%',
      left: '10%',
      right: '10%',
      bottom: '15%'
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
        name: '瘫痪比例',
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
        name: '资源开支',
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
        name: '红方资源累计消耗 ($)',
        type: 'bar',
        yAxisIndex: 1,
        data: cost,
        itemStyle: {
          color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
            { offset: 0, color: '#10b981' },
            { offset: 1, color: '#047857' }
          ])
        }
      },
      {
        name: '蓝方带宽瘫痪比例 (%)',
        type: 'line',
        data: collapse,
        itemStyle: {
          color: '#00e1ff'
        },
        lineStyle: {
          width: 2.5,
          shadowColor: 'rgba(0, 225, 255, 0.5)',
          shadowBlur: 5
        }
      }
    ]
  };

  lineBarChart.setOption(option);
};

onMounted(() => {
  nextTick(() => {
    loadAndAggregateData();
  });
});

onBeforeUnmount(() => {
  if (radarChart) {
    radarChart.dispose();
    radarChart = null;
  }
  if (lineBarChart) {
    lineBarChart.dispose();
    lineBarChart = null;
  }
});
</script>

<style scoped>
.tech-panel {
  border-radius: 4px;
  background-color: rgba(8, 12, 22, 0.5);
  box-shadow: 0 0 10px rgba(0, 225, 255, 0.03);
}

.summary-card {
  padding: 12px 16px;
  display: flex;
  flex-col: column;
  justify-content: center;
}
</style>
