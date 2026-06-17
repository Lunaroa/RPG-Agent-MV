const IPC_REMOTE_PREFIX = /^Error invoking remote method '[^']+':\s*/i;
const WRAPPED_ERROR_PREFIX = /^Error:\s*/i;

const DEVELOPER_TERMS = /\b(remote|origin|push|pull|fetch|upstream|downstream)\b/i;

export interface UserFacingError {
  message: string;
  detail?: string;
}

export function formatUserFacingError(errorValue: unknown, context: 'version' | 'general' = 'general'): UserFacingError {
  const raw = errorValue instanceof Error ? errorValue.message : String(errorValue || '操作失败');
  const stripped = unwrapIpcError(raw);
  const mapped = mapKnownError(stripped, context);
  return sanitizeDeveloperTerms(mapped);
}

export function formatUserFacingErrorMessage(errorValue: unknown, context: 'version' | 'general' = 'general'): string {
  return formatUserFacingError(errorValue, context).message;
}

function unwrapIpcError(message: string): string {
  let next = message.trim();
  if (IPC_REMOTE_PREFIX.test(next)) {
    next = next.replace(IPC_REMOTE_PREFIX, '').trim();
  }
  while (WRAPPED_ERROR_PREFIX.test(next)) {
    next = next.replace(WRAPPED_ERROR_PREFIX, '').trim();
  }
  return next || '操作失败';
}

function mapKnownError(message: string, context: 'version' | 'general'): UserFacingError {
  if (/缺少 Git 依赖|未找到 git 命令|spawn(?:Sync)? git ENOENT|ENOENT/i.test(message)) {
    return { message: '需要安装 Git 才能使用版本管理' };
  }
  if (/Git 执行失败/i.test(message)) {
    const detail = message.replace(/^Git 执行失败：?/i, '').trim();
    return {
      message: context === 'version' ? '保存版本失败，请重试' : '操作失败，请重试',
      detail: detail || message,
    };
  }
  if (/超时.*版本管理未启用/i.test(message)) {
    return { message: '保存版本超时，请稍后重试' };
  }
  if (/Git 仓库根目录不是当前项目/i.test(message)) {
    return { message: '当前目录不是有效的版本管理位置' };
  }
  if (/项目目录不存在/i.test(message)) {
    return { message: '项目目录不存在，请重新选择项目' };
  }
  if (/\[CONTROLLED_EDITING_DISABLED\]/i.test(message)) {
    return { message: '请先启用版本管理' };
  }
  return { message };
}

function sanitizeDeveloperTerms(result: UserFacingError): UserFacingError {
  const combined = `${result.message} ${result.detail || ''}`;
  if (!DEVELOPER_TERMS.test(combined)) {
    return result;
  }
  return {
    message: result.message.includes('失败') ? result.message : '操作失败，请重试',
    detail: result.detail || combined,
  };
}
