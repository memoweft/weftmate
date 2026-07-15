/** Agent 执行自主度。保持本模块无运行期依赖，供 settings 与 agent 安全共享。 */
export type Autonomy = 'suggest' | 'ask' | 'auto';

/** 新用户安全默认：每次确认。 */
export const DEFAULT_AUTONOMY: Autonomy = 'ask';

export function isAutonomy(value: unknown): value is Autonomy {
  return value === 'suggest' || value === 'ask' || value === 'auto';
}

/** 缺失/损坏设置回落 ask；已有用户显式保存的合法档位原样保留。 */
export function normalizeAutonomy(value: unknown): Autonomy {
  return isAutonomy(value) ? value : DEFAULT_AUTONOMY;
}
