const KNOWN_ISSUE_TRANSLATIONS: Record<string, string> = {
  'Auto-imported from a local RPG Maker MV installation; EULA/license has not been reviewed for redistribution.':
    '从本机 RPG Maker MV 安装目录自动导入；再分发许可尚未人工审核。',
  'Offline render does not show events, player, plugins, weather, screen tint, animations, or runtime effects.':
    '离线预览仅渲染图块层，不包含事件、角色、插件、天气、画面色调、动画或运行时效果。',
  'Cartographer must open the screenshot and inspect the map visually before final selection.':
    '选定前请打开截图并肉眼检查地图实际布局。',
};

export function translateKnownIssue(issue: string): string {
  const trimmed = issue.trim();
  return KNOWN_ISSUE_TRANSLATIONS[trimmed] ?? trimmed;
}

export function translateKnownIssues(issues: readonly string[]): string[] {
  return issues.map(translateKnownIssue);
}
