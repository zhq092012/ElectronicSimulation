<template>
  <el-dialog v-model="visible" title="SQLite Wasm 实时 SQL 沙箱" width="800px" top="5vh">
    <div class="flex flex-col gap-3 min-h-[400px]">
      <el-input
        v-model="sqlQuery"
        type="textarea"
        :rows="5"
        placeholder="请输入任何标准的 SQL 查询语句..."
        class="font-mono text-xs"
      />
      <div class="flex justify-between items-center">
        <span class="text-[10px] text-dim">直接在此处对底层数据库进行自由探查</span>
        <el-button type="primary" size="small" @click="runQuery">
          ▶ 执行 SQL 指令
        </el-button>
      </div>

      <!-- SQL Query Result Area -->
      <div class="flex-1 overflow-auto rounded border border-cyan-950/60 bg-black/30 mt-2 p-2">
        <!-- If Query has error -->
        <div v-if="sqlError" class="p-3 text-xs font-mono text-red-400 bg-red-950/30">
          [Error]: {{ sqlError }}
        </div>
        
        <!-- Result Table -->
        <el-table v-else-if="sqlResults.length > 0" :data="sqlResults" size="small" height="300px">
          <el-table-column
            v-for="col in Object.keys(sqlResults[0] || {})"
            :key="col"
            :prop="col"
            :label="col"
            show-overflow-tooltip
          />
        </el-table>
        
        <div v-else class="text-dim text-center text-xs mt-10">暂无查询结果，执行 SQL 查询后在此展示。</div>
      </div>
    </div>
  </el-dialog>
</template>

<script setup lang="ts">
import { ref } from 'vue';
import { sqliteClient } from '../db/sqlite-client';

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
