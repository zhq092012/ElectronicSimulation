import { ref } from 'vue';
import type { TacticalMatrices } from '../types/electronic';

class SQLiteClient {
  private worker: Worker | null = null;
  private pendingQueries = new Map<string, { resolve: (value: unknown) => void; reject: (reason?: unknown) => void }>();
  
  private initResolver: (() => void) | null = null;
  private initRejecter: ((err: Error) => void) | null = null;
  
  public isInitialized = ref(false);
  public initError = ref<string | null>(null);

  constructor() {
    // 使用 Vite 的 import.meta.url 加载 Web Worker
    this.worker = new Worker(
      new URL('../workers/sqlite.worker.ts', import.meta.url),
      { type: 'module' }
    );

    this.worker.onmessage = (event: MessageEvent) => {
      const { type, id, result, error, changes } = event.data;

      if (type === 'INIT_SUCCESS') {
        this.isInitialized.value = true;
        if (this.initResolver) {
          this.initResolver();
          this.initResolver = null;
          this.initRejecter = null;
        }
        return;
      }

      if (type === 'INIT_ERROR') {
        this.initError.value = error;
        this.isInitialized.value = false;
        if (this.initRejecter) {
          this.initRejecter(new Error(error));
          this.initResolver = null;
          this.initRejecter = null;
        }
        return;
      }

      const pending = this.pendingQueries.get(id);
      if (!pending) return;

      if (type === 'SUCCESS') {
        pending.resolve(result !== undefined ? result : { changes });
      } else if (type === 'ERROR') {
        pending.reject(new Error(error));
      }
      this.pendingQueries.delete(id);
    };
  }

  /**
   * 等待数据库 Worker 初始化完成
   */
  public ready(): Promise<void> {
    if (this.isInitialized.value) return Promise.resolve();
    if (this.initError.value) return Promise.reject(new Error(this.initError.value));
    
    return new Promise<void>((resolve, reject) => {
      this.initResolver = resolve;
      this.initRejecter = reject;
      this.worker?.postMessage({ type: 'INIT' });
    });
  }

  public init(): Promise<void> {
    return this.ready();
  }

  /**
   * 发送指令到 Web Worker
   */
  private send<T>(type: 'QUERY' | 'EXEC' | 'CALCULATE_WINDOWS' | 'AUTO_ALLOCATE_WEAPONS' | 'UPDATE_SATELLITE_POSITIONS' | 'GENERATE_MATRICES', sql: string, params?: unknown[]): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const id = Math.random().toString(36).substring(2, 9);
      this.pendingQueries.set(id, { resolve: resolve as (val: unknown) => void, reject });
      this.worker?.postMessage({ type, id, sql, params });
    });
  }

  /**
   * 执行查询语句 (返回行数据对象数组)
   */
  public query<T>(sql: string, params?: unknown[]): Promise<T[]> {
    return this.send<T[]>('QUERY', sql, params);
  }

  /**
   * 执行指令语句 (INSERT, UPDATE, DELETE 等)
   */
  public execute(sql: string, params?: unknown[]): Promise<{ changes: number }> {
    return this.send<{ changes: number }>('EXEC', sql, params);
  }

  /**
   * 触发 Web Worker 中的 satellite.js 轨道视算
   */
  public calculateWindows(scenarioId: string): Promise<{ message: string }> {
    return this.send<{ message: string }>('CALCULATE_WINDOWS', '', [scenarioId]);
  }

  /**
   * 更新卫星在特定时间下的经纬度坐标
   */
  public updateSatellitePositions(currentTime: number): Promise<void> {
    return this.send<void>('UPDATE_SATELLITE_POSITIONS', '', [currentTime]);
  }

  /**
   * 触发 Web Worker 中的自动化武器分配及交战结算
   * @param scenarioEndTime 场景结束时间戳 (Unix)，用于计算 HARD kill 剩余破坏时长
   */
  public allocateWeapons(intensity: string, currentTime: number, scenarioId: string, scenarioEndTime: number): Promise<{ engagements_created: number }> {
    return this.send<{ engagements_created: number }>('AUTO_ALLOCATE_WEAPONS', '', [{ intensity, currentTime, scenarioId, scenarioEndTime }]);
  }

  /**
   * 解算四大战术算力矩阵 (passMatrix, visibleMatrix, overheadMatrix, attackMatrix)
   */
  public generateMatrices(scenarioId: string = 'scen-001'): Promise<TacticalMatrices> {
    return this.send<TacticalMatrices>('GENERATE_MATRICES', '', [scenarioId]);
  }
}

export const sqliteClient = new SQLiteClient();
export default sqliteClient;
