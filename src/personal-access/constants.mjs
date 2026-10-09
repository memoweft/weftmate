export const VERSION = 3;

export const SINGLE_ACCOUNT_VERSION = 2;

export const LEGACY_VERSION = 1;

export const SESSION_MS = 30 * 24 * 60 * 60 * 1000;

export const SETUP_GRANT_MS = 10 * 60 * 1000;

export const COOKIE = 'wm_personal_session';

export const CSRF_HEADER = 'x-weftmate-csrf';

export const MAX_BODY = 12 * 1024;

export const MAX_TEXT = 8 * 1024;

export const MAX_PAGE = 200;

export const MAX_COMMANDS = 5_000;

export const MAX_TOOL_APPROVALS = 5_000;

export const MAX_COMMAND_TOOL_APPROVALS = 256;

export const MAX_ACTIVE_PASSWORD_DEVICES = 32;

export const MAX_ACCOUNTS = 64;

export const MAX_UNRECONCILED_TEXT_BYTES = 8 * 1024 * 1024;

export const MAX_PROJECTS = 64;

export const MAX_PROJECT_FILES = 2_000;

export const MAX_SOURCE_SNAPSHOTS = 5_000;

export const MAX_BROWSER_SNAPSHOTS = 5_000;

export const MAX_BROWSER_CAPTURES = 500;

export const MAX_LOCAL_TURNS = 5_000;

export const DISPATCH_TIMEOUT_MS = 30_000;

export const CLOSE_TIMEOUT_MS = 3_000;

export const MODEL_TIMEOUT_MS = 300_000;

export const MODEL_JSON_MAX = 4 * 1024 * 1024;

export const MODEL_SSE_MAX = 8 * 1024 * 1024;

export const ID = /^[A-Za-z0-9_-]{1,128}$/;

export const MODEL_PROFILE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

export const REQUEST_ID = /^[A-Za-z0-9_.:-]{1,128}$/;

export const TOOL_RUNTIME_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export const SAFE_CODES = new Set([
  'RUNTIME_UNAVAILABLE', 'MODEL_UNAVAILABLE', 'SESSION_UNAVAILABLE',
  'CAPABILITY_UNAVAILABLE', 'TARGET_UNAVAILABLE', 'MODEL_ROUTE_BLOCKED',
  'INVALID_COMMAND', 'NOT_FOUND', 'CONFLICT', 'SESSION_READ_ONLY', 'SESSION_ARCHIVED', 'SESSION_BUSY',
]);

export const PUBLIC_CODES = new Set([
  'CHAT_INITIALIZING', 'CHAT_UNAVAILABLE', 'MAIN_CHAT_PROTECTED', 'MAIN_CHAT_ROUTE_REQUIRED', 'CURSOR_RESET_REQUIRED', 'REVISION_CHANGED',
  'SOURCE_UNAVAILABLE', 'TEMPORARY_CONTEXT_CONFIRMATION_REQUIRED', 'SHARED_CONTEXT_UNAVAILABLE', 'SIDE_CHAT_CONFIRMATION_REQUIRED',
  'OFFLINE_CLOUD_REQUIRED', 'OFFLINE_MODEL_REQUIRED', 'OFFLINE_RESET_REQUIRED',
  'USAGE_LIMIT_REACHED',
  ...SAFE_CODES, 'INVALID_HEALTH_SUMMARY', 'INVALID_DATE', 'STALE_HEALTH_SUMMARY', 'INVALID_REQUEST', 'REQUEST_CONFLICT', 'UNAUTHORIZED',
  'FORBIDDEN', 'UNSUPPORTED_MEDIA_TYPE', 'BODY_TOO_LARGE', 'ORIGIN_NOT_ALLOWED',
  'SERVICE_CLOSING', 'SERVICE_UNAVAILABLE', 'BACKEND_UNAVAILABLE', 'BACKEND_TIMEOUT',
  'CAPACITY_LIMIT', 'STORAGE_UNAVAILABLE', 'INVALID_CREDENTIALS', 'INVALID_SETUP_GRANT',
  'LOGIN_RATE_LIMITED', 'ACCOUNT_ALREADY_CONFIGURED', 'ACCOUNT_ALREADY_EXISTS',
  'ACCOUNT_LOGIN_REQUIRED', 'AMBIGUOUS_AUTH',
  'DEVICE_LIMIT', 'SESSION_REPLACED', 'SESSION_READ_ONLY', 'SESSION_EXPIRED',
  'TOOL_SOURCE_UNAVAILABLE', 'APPROVAL_NOT_PENDING', 'QUESTION_NOT_PENDING', 'QUESTION_OUTCOME_UNCONFIRMED',
  'TOOL_INTENT_UNCONFIRMED',
  'MEMORY_DISABLED', 'MEMORY_UNAVAILABLE', 'MEMORY_DELETE_UNAVAILABLE',
  'MEMORY_ACTION_UNSUPPORTED', 'MEMORY_SEARCH_LIMIT', 'MEMORY_REVISION_CHANGED',
  'MEMORY_RESPONSE_INVALID', 'MEMORY_NOT_CURRENT', 'MEMORY_DELETE_CONFLICT',
  'MEMORY_SOURCE_UNRECOVERABLE', 'MEMORY_COMMAND_REJECTED',
  'MEMORY_REQUEST_CONFLICT',
  'MEMORY_REPLAY_REDACTED',
  'ATTACHMENT_NOT_FOUND',
  'ARTIFACT_UNVERIFIED',
  'TASK_NOT_READY',
  'PROJECT_WINDOWS_REQUIRED', 'PROJECT_UNSAFE_PATH', 'PROJECT_ROOT_CHANGED',
  'PROJECT_FILE_UNAVAILABLE', 'PROJECT_FILE_CHANGED', 'PROJECT_INVALID_UTF8',
  'PROJECT_LINE_OUT_OF_RANGE', 'PROJECT_LINE_TOO_LONG', 'PROJECT_READER_TIMEOUT',
  'PROJECT_READER_INVALID', 'PROJECT_REVOKED', 'PROJECT_NOT_SELECTED',
  'PROJECT_SOURCE_UNVERIFIED', 'PROJECT_MODEL_CHANGED',
  'PROJECT_REVISION_CHANGED', 'PROJECT_READ_ONLY', 'PROJECT_WRITE_OUTSIDE',
  'BROWSER_UNAVAILABLE', 'BROWSER_BUSY', 'BROWSER_CANCELLED', 'BROWSER_URL_INVALID',
  'BROWSER_TARGET_BLOCKED', 'BROWSER_NETWORK_LIMIT', 'BROWSER_NETWORK_ERROR',
  'BROWSER_RENDERER_FAILED', 'BROWSER_LOGIN_REQUIRED', 'BROWSER_HTTP_ERROR',
  'BROWSER_EMPTY_PAGE', 'BROWSER_SOURCE_UNVERIFIED', 'BROWSER_URL_REQUIRED',
  'BROWSER_DNS_TIMEOUT', 'BROWSER_DNS_ERROR', 'BROWSER_DOWNGRADE_BLOCKED', 'BROWSER_PAGE_CHANGED',
  'BROWSER_CLEANUP_FAILED',
  'CONVERSATION_CONTEXT_UNAVAILABLE', 'CONVERSATION_NOT_READY', 'CONVERSATION_SYNC_CHANGED',
  'LOCAL_TURN_RUNNING', 'LOCAL_TURN_UNCONFIRMED',
  'SOURCE_DEVICE_UPGRADE_REQUIRED',
  'ACCOUNT_MODEL_UNAVAILABLE', 'ACCOUNT_MODEL_REVISION_CHANGED', 'ACCOUNT_MODEL_BUSY',
  'ACCOUNT_MODEL_SECRET_REQUIRED', 'ACCOUNT_MODEL_ROUTE_UNCONFIRMED',
  'IMAGE_REJECTED',
]);

export const LEGACY_SCOPES = new Set(['sessions:read', 'commands:write']);

export const SCOPES = new Set([...LEGACY_SCOPES, 'account:manage']);

export const KINDS = new Set(['session.create', 'session.message', 'chat.message', 'session.cancel', 'desktop.open_app']);

export const INTERNAL_ARTIFACT_KIND = 'desktop.write_artifact';

export const GENERAL_TOOL_NAME = /^[A-Za-z][A-Za-z0-9_.:-]{0,159}$/;

export const EXECUTION_STATES = new Set(['running', 'completed', 'failed', 'cancelled', 'uncertain']);

export const JOB_STATES = new Set(['running', 'stopping', 'completed', 'killed', 'failed', 'uncertain', 'unconfirmed']);

export const EXECUTION_FIELDS = ['executionId', 'sourceCommandId', 'sourceReceiptId', 'rootCallId', 'callId',
  'toolName', 'turn', 'state', 'argumentsHash', 'runtimeId', 'startedAt', 'updatedAt', 'finishedAt', 'resultHash', 'jobId', 'jobState', 'jobObservedAt'];

export const APPROVAL_OUTCOMES = new Set(['allowed-once', 'rejected', 'cancelled', 'unavailable']);

export const APPROVAL_DECISIONS = new Set(['allowed-once', 'rejected']);

export const APPROVAL_STATES = new Set(['pending', 'answered', 'resolved', 'unavailable']);

export const APPROVAL_PUBLIC_FIELDS = ['approvalId', 'sessionId', 'taskId', 'sourceCommandId', 'sourceReceiptId',
  'turn', 'callId', 'rootCallId', 'toolName', 'reason', 'createdAt', 'status',
  'decisionOutcome', 'decisionRequestId', 'decisionScope', 'riskCategories', 'answeredAt', 'outcome', 'resolvedAt'];

export const APPROVAL_FIELDS = [...APPROVAL_PUBLIC_FIELDS, 'messageHash', 'argumentsHash', 'runtimeId',
  'invalidatedAt', 'invalidationReason'];

export const APPROVAL_INVALIDATION_REASONS = new Set(['runtime_unavailable', 'runtime_replaced',
  'service_recovered', 'service_closing', 'source_unavailable', 'task_stopped', 'model_unavailable', 'approval_timeout']);

export const QUESTION_PUBLIC_FIELDS = ['questionRpcId', 'sessionId', 'taskId', 'sourceCommandId', 'sourceReceiptId',
  'turn', 'questions', 'createdAt', 'status', 'answer', 'answerRequestId', 'answeredAt', 'outcome',
  'resolvedAt', 'answerAcceptedAt', 'reasonCode', 'unavailableAt'];

export const QUESTION_FIELDS = [...QUESTION_PUBLIC_FIELDS, 'runtimeId', 'messageHash', 'sourceSeq', 'observedSeq',
  'questionsHash', 'answerHash', 'deliveryState', 'deliveryAttemptedAt'];

export const QUESTION_REASONS = new Set(['RUNTIME_UNAVAILABLE', 'SESSION_REPLACED', 'SERVICE_CLOSING',
  'TOOL_SOURCE_UNAVAILABLE', 'TASK_NOT_READY', 'MODEL_UNAVAILABLE', 'QUESTION_NOT_PENDING', 'QUESTION_OUTCOME_UNCONFIRMED']);

export const QUESTION_DELIVERY_STATES = new Set(['ready', 'dispatching', 'accepted', 'not-pending', 'unconfirmed']);

export const IMAGE_REASONS = new Set(['MODEL_DOES_NOT_SUPPORT_IMAGES', 'INVALID_IMAGE_BASE64',
  'TOO_MANY_IMAGES', 'IMAGES_TOO_LARGE', 'INVALID_IMAGE', 'IMAGE_TYPE_MISMATCH',
  'IMAGE_TOO_LARGE', 'IMAGE_TOO_MANY_PIXELS']);

export const IMAGE_CONTENT_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif']);

export const PROJECT_NAME = /^[\p{L}\p{N}][\p{L}\p{N} ._()\-]{0,79}$/u;

export const FILE_ID = /^file-[a-f0-9]{48}$/;

export const SNAPSHOT_ID = /^source-[a-f0-9]{48}$/;

export const WEB_SNAPSHOT_ID = /^source-[a-f0-9]{48}$/;

export const LINK_ID = /^link-[a-f0-9]{40}$/;

export const CONVERSATION_ID = /^(?:conversation-)?[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

export const SYNC_EVENT_ID = /^(?:[A-Za-z][A-Za-z0-9_-]{0,31}-)?[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
