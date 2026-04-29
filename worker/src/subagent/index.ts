export { BackgroundManager, type SubagentTask, type BackgroundManagerConfig } from './background-manager.js';
export { CircuitBreakerError } from './background-manager.js';
export {
  detectCategory,
  delegateByCategory,
  runCategoryRoute,
  type Category,
  type CategoryRoute,
} from './categories.js';