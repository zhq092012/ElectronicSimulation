<template>
  <div class="weapon-assignment-container">
    <div class="panel-header">
      <span>实时兵力分配清单</span>
      <span class="header-subtitle">Force Assignment Table</span>
    </div>
    <div class="table-wrapper">
      <el-table 
        :data="activeEngagements" 
        size="small" 
        height="100%" 
        :row-class-name="tableRowClassName"
      >
        <el-table-column label="交战状态" width="80" align="center">
          <template #default="{ row }">
            <span v-if="row.is_successful" class="status-icon success-icon">💥</span>
            <span v-else class="status-icon pending-icon">⚡</span>
          </template>
        </el-table-column>
        <el-table-column label="目标(蓝方)" min-width="120" show-overflow-tooltip>
          <template #default="{ row }">
            <span class="target-blue">{{ row.targetName }}</span>
          </template>
        </el-table-column>
        <el-table-column label="武器(红方)" min-width="120" show-overflow-tooltip>
          <template #default="{ row }">
            <span class="weapon-red">{{ row.weaponName }}</span>
          </template>
        </el-table-column>
        <el-table-column label="动作" width="80">
          <template #default="{ row }">
            <span :class="['action-type', row.action_type === 'DESTROY' ? 'destroy-type' : 'jam-type']">
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
      <div v-if="activeEngagements.length === 0" class="empty-message">
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
  if (!sqliteClient.isInitialized.value) {
    return; // Wait until DB is ready
  }
  if (props.currentTime === 0) {
    activeEngagements.value = [];
    return;
  }
  
  // Find engagements active exactly at this minute
  try {
    const res = await sqliteClient.query<any>(`
      SELECT e.*, w.name as weaponName, a.id as targetName, a.id as targetId 
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

watch(() => [props.currentTime, sqliteClient.isInitialized.value], fetchEngagements);
onMounted(fetchEngagements);

</script>

<style scoped lang="scss">
@import "../styles/theme.scss";

.weapon-assignment-container {
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
  min-height: 0;
}

.header-subtitle {
  font-size: 12px;
  color: $text-dim;
}

.table-wrapper {
  flex: 1;
  overflow: auto;
  background-color: rgba(0, 0, 0, 0.3); // bg-black/30
  border-radius: 4px;
  border: 1px solid rgba(0, 225, 255, 0.15); // border-cyan-950/60
  padding: 4px;
}

.status-icon {
  font-weight: bold;
  font-size: 18px; // text-lg
  display: inline-block;
  
  &.success-icon {
    color: #ef4444; // text-red-500
    animation: pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite;
  }
  
  &.pending-icon {
    color: #eab308; // text-yellow-500
    animation: pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite;
  }
}

.target-blue {
  color: #67e8f9; // text-cyan-300
  font-weight: bold;
}

.weapon-red {
  color: #f87171; // text-red-400
  font-weight: bold;
}

.action-type {
  &.destroy-type {
    color: #ef4444; // text-red-500
  }
  &.jam-type {
    color: #facc15; // text-yellow-400
  }
}

.empty-message {
  text-align: center;
  color: $text-dim;
  font-size: 12px;
  margin-top: 40px; // mt-10
}

@keyframes pulse {
  0%, 100% {
    opacity: 1;
  }
  50% {
    opacity: .5;
  }
}

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
