; RPG Agent MV — NSIS uninstall hooks (electron-builder).
; User data folder name must match package.json "name" (rpg-agent-mv).

!ifndef RPG_AGENT_MV_USER_DATA_DIR
  !define RPG_AGENT_MV_USER_DATA_DIR "rpg-agent-mv"
!endif

!macro customUnWelcomePage
  !define MUI_WELCOMEPAGE_TITLE "卸载 RPG Agent MV / Uninstall RPG Agent MV"
  !define MUI_WELCOMEPAGE_TEXT "此向导将卸载 RPG Agent MV。$\r$\n$\r$\n卸载过程中会询问是否删除保存在您用户目录中的数据（设置、项目记录、数据库、Agent 会话与记忆等）。$\r$\n默认保留数据，以便日后重新安装时继续使用。$\r$\n$\r$\nThis wizard will remove RPG Agent MV.$\r$\nYou will be asked whether to delete profile data (settings, projects, database, Agent memory).$\r$\nData is kept by default so a future reinstall can reuse it."
  !insertmacro MUI_UNPAGE_WELCOME
!macroend

!macro customUnInstall
  !ifdef __UNINSTALL__
    ${if} ${isUpdated}
      Goto rpg_agent_mv_uninstall_done
    ${endIf}

    MessageBox MB_YESNO|MB_ICONQUESTION \
      "是否删除用户数据？$\r$\n$\r$\n包含：设置、项目记录、数据库、Agent 会话与记忆等。$\r$\n位置：$APPDATA\${RPG_AGENT_MV_USER_DATA_DIR}$\r$\n$\r$\nDelete user data?$\r$\nIncludes settings, projects, database, Agent sessions and memory.$\r$\nLocation: $APPDATA\${RPG_AGENT_MV_USER_DATA_DIR}" \
      /SD IDNO \
      IDNO rpg_agent_mv_keep_user_data \
      IDYES rpg_agent_mv_delete_user_data

    rpg_agent_mv_delete_user_data:
      SetShellVarContext current
      RMDir /r "$APPDATA\${RPG_AGENT_MV_USER_DATA_DIR}"
      Goto rpg_agent_mv_uninstall_done

    rpg_agent_mv_keep_user_data:
      MessageBox MB_OK|MB_ICONINFORMATION \
        "用户数据已保留，可稍后手动删除：$\r$\n$APPDATA\${RPG_AGENT_MV_USER_DATA_DIR}$\r$\n$\r$\nYour data was kept at:$\r$\n$APPDATA\${RPG_AGENT_MV_USER_DATA_DIR}"
      Goto rpg_agent_mv_uninstall_done

    rpg_agent_mv_uninstall_done:
  !endif
!macroend
