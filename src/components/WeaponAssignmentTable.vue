<template>
  <div class="w-full h-full flex flex-col min-h-0">
    <div class="panel-header">
      <span>实时兵力分配清单</span>
      <span class="text-xs text-dim">Force Assignment Table</span>
    </div>
    <div class="flex-1 overflow-auto bg-black/30 rounded border border-cyan-950/60 p-1">
      <el-table 
        :data="activeEngagements" 
        size="small" 
        height="100%" 
        :row-class-name="tableRowClassName"
      >
        <el-table-column label="交战状态" width="80" align="center">
          <template #default="{ row }">
            <span v-if="row.is_successful" class="text-red-500 font-bold animate-pulse text-lg">💥</span>
            <span v-else class="text-yellow-500 font-bold animate-pulse text-lg">⚡</span>
          </template>
        </el-table-column>
        <el-table-column label="目标(蓝方)" min-width="120" show-overflow-tooltip>
          <template #default="{ row }">
            <span class="text-cyan-300 font-bold">{{ row.targetName }}</span>
          </template>
        </el-table-column>
        <el-table-column label="武器(红方)" min-width="120" show-overflow-tooltip>
          <template #default="{ row }">
            <span class="text-red-400 font-bold">{{ row.weaponName }}</span>
          </template>
        </el-table-column>
        <el-table-column label="动作" width="80">
          <template #default="{ row }">
            <span :class="row.action_type === 'DESTROY' ? 'text-red-500' : 'text-yellow-400'">
              {{ row.action_type === 'DESTROY' ? '硬摧毁' : '电磁干扰' }}
            </span>
          </template>
        </el-table-column>
        <el-table-column label="干信比(J/S)" width="90" align="right">
          <template #default="{ row }">
            <span class="digital-font">{{ row.final_js_ratio ? row.final_js_ratio.toFixed(2) : '-' }}</span>
          </template>
        </el-table-column>
      </el-table>
      <div v-if="activeEngagements.length === 0" class="text-center text-dim text-xs mt-10">
        当前分钟暂无交战行动
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, watch, onMounted } from 'vue';
import { sqliteClient } from '../db/sqlite-client';

const props = defineProps<{
  currentTime: number; // Unix timestamp for current sim tick
}>();

const activeEngagements = ref<any[]>([]);

const fetchEngagements = async () => {
  if (props.currentTime === 0) {
    activeEngagements.value = [];
    return;
  }
  
  // Find engagements active exactly at this minute
  try {
    const res = await sqliteClient.query<any>(`
      SELECT e.*, w.name as weaponName, a.name as targetName, a.id as targetId 
      FROM engagements e
      JOIN weapons w ON e.weapon_id = w.id
      JOIN communication_windows cw ON e.target_window_id = cw.id
      JOIN assets a ON cw.target_id = a.id OR cw.source_id = a.id
      WHERE e.action_time = ?
      GROUP BY e.id
    `, [props.currentTime]);
    activeEngagements.value = res;
  } catch (err) {
    console.error("Failed to fetch active engagements", err);
  }
};

const tableRowClassName = ({ row }: { row: any }) => {
  if (row.action_type === 'DESTROY') return 'bg-red-950/20';
  return 'bg-yellow-950/10';
};

watch(() => props.currentTime, fetchEngagements);
onMounted(fetchEngagements);

</script>

<style scoped>
:deep(.el-table) {
  background-color: transparent !important;
  color: #a0aec0;
}
:deep(.el-table th.el-table__cell) {
  background-color: rgba(15, 23, 42, 0.8) !important;
  border-bottom: 1px solid rgba(6, 182, 212, 0.3);
  color: #22d3ee;
}
:deep(.el-table tr) {
  background-color: transparent !important;
}
:deep(.el-table td.el-table__cell) {
  border-bottom: 1px solid rgba(6, 182, 212, 0.1);
}
:deep(.el-table--enable-row-hover .el-table__body tr:hover > td.el-table__cell) {
  background-color: rgba(6, 182, 212, 0.1) !important;
}
</style>
