<template>
  <el-dialog v-model="visible" title="SQLite Wasm 实时 SQL 沙箱" width="800px" top="5vh">
    <div class="sandbox-container">
      <el-input v-model="sqlQuery" type="textarea" :rows="5" placeholder="请输入任何标准的 SQL 查询语句..."
        class="sql-input-area" />
      <div class="actions-row">
        <span class="info-text">直接在此处对底层数据库进行自由探查</span>
        <el-button type="primary" size="small" @click="runQuery">
          ▶ 执行 SQL 指令
        </el-button>
      </div>

      <!-- SQL Query Result Area -->
      <div class="result-area">
        <!-- If Query has error -->
        <div v-if="sqlError" class="error-message">
          [Error]: {{ sqlError }}
        </div>

        <!-- Result Table -->
        <el-table v-else-if="sqlResults.length > 0" :data="sqlResults" size="small" height="300px">
          <el-table-column v-for="col in Object.keys(sqlResults[0] || {})" :key="col" :prop="col" :label="col"
            show-overflow-tooltip />
        </el-table>

        <div v-else class="empty-text">暂无查询结果，执行 SQL 查询后在此展示。</div>
      </div>
    </div>
  </el-dialog>
</template>

<script setup lang="ts">
import { ref } from 'vue';
import { sqliteClient } from '@/db/sqlite-client';

const visible = ref(false);
const sqlQuery = ref("SELECT * FROM assets LIMIT 10;");
const sqlResults = ref<any[]>([]);
const sqlError = ref<string>('');

const openDialog = () => {
  visible.value = true;
};

const runQuery = async () => {
  sqlError.value = '';
  try {
    const results = await sqliteClient.query<any>(sqlQuery.value);
    sqlResults.value = results;
  } catch (err: any) {
    sqlError.value = err.message;
    sqlResults.value = [];
  }
};

defineExpose({
  openDialog
});
</script>

<style scoped lang="scss">
@import "@/styles/theme.scss";

.sandbox-container {
  display: flex;
  flex-direction: column;
  gap: 12px;
  min-height: 400px;
}

.sql-input-area {
  font-family: monospace;
  font-size: 12px;
}

.actions-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.info-text {
  font-size: 10px;
  color: $text-dim;
}

.result-area {
  flex: 1;
  overflow: auto;
  border-radius: 4px;
  border: 1px solid rgba(0, 225, 255, 0.15); // border-cyan-950/60 polyfill
  background-color: rgba(0, 0, 0, 0.3); // bg-black/30
  margin-top: 8px;
  padding: 8px;
}

.error-message {
  padding: 12px;
  font-size: 12px;
  font-family: monospace;
  color: #f87171; // text-red-400
  background-color: rgba(127, 29, 29, 0.3); // bg-red-950/30
}

.empty-text {
  color: $text-dim;
  text-align: center;
  font-size: 12px;
  margin-top: 40px; // mt-10
}
</style>
