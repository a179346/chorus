import { describe, it, expect } from 'vitest';
import { IpcChannels } from '../src/shared/ipc';
import type { IpcInvokeMap, IpcPushMap } from '../src/shared/ipc';
import fs from 'node:fs';
import path from 'node:path';

// Read source files to verify channel usage consistency
const mainIndexSrc = fs.readFileSync(path.join(__dirname, '../src/main/index.ts'), 'utf-8');
const preloadSrc = fs.readFileSync(path.join(__dirname, '../src/main/preload.ts'), 'utf-8');
const electronDts = fs.readFileSync(path.join(__dirname, '../src/renderer/electron.d.ts'), 'utf-8');

describe('IPC Channel Consistency', () => {
  describe('all invoke channels have handlers in main process', () => {
    // Map channel constant names to their string values
    const invokeChannelNames: Array<{ constName: string; value: string }> = [
      { constName: 'SESSION_CREATE', value: IpcChannels.SESSION_CREATE },
      { constName: 'SESSION_LIST', value: IpcChannels.SESSION_LIST },
      { constName: 'SESSION_GET', value: IpcChannels.SESSION_GET },
      { constName: 'SESSION_RENAME', value: IpcChannels.SESSION_RENAME },
      { constName: 'SESSION_END', value: IpcChannels.SESSION_END },
      { constName: 'SESSION_SWITCH', value: IpcChannels.SESSION_SWITCH },
      { constName: 'PTY_WRITE', value: IpcChannels.PTY_WRITE },
      { constName: 'PTY_RESIZE', value: IpcChannels.PTY_RESIZE },
      { constName: 'SHELL_WRITE', value: IpcChannels.SHELL_WRITE },
      { constName: 'SHELL_RESIZE', value: IpcChannels.SHELL_RESIZE },
      { constName: 'TOOLKIT_LIST', value: IpcChannels.TOOLKIT_LIST },
      { constName: 'TOOLKIT_EXECUTE', value: IpcChannels.TOOLKIT_EXECUTE },
      { constName: 'TOOLKIT_SAVE', value: IpcChannels.TOOLKIT_SAVE },
      { constName: 'TOOLKIT_ADD', value: IpcChannels.TOOLKIT_ADD },
      { constName: 'TOOLKIT_UPDATE', value: IpcChannels.TOOLKIT_UPDATE },
      { constName: 'TOOLKIT_DELETE', value: IpcChannels.TOOLKIT_DELETE },
      { constName: 'APP_GET_STATE', value: IpcChannels.APP_GET_STATE },
      { constName: 'APP_SAVE_STATE', value: IpcChannels.APP_SAVE_STATE },
      { constName: 'APP_GET_NEW_SESSION_DEFAULTS', value: IpcChannels.APP_GET_NEW_SESSION_DEFAULTS },
      { constName: 'DIALOG_SELECT_DIRECTORY', value: IpcChannels.DIALOG_SELECT_DIRECTORY },
    ];

    for (const { constName, value } of invokeChannelNames) {
      it(`should have ipcMain.handle for "${value}" (IpcChannels.${constName})`, () => {
        // Main process uses the constant name, e.g. ipcMain.handle(IpcChannels.SESSION_CREATE, ...)
        expect(mainIndexSrc).toContain(`IpcChannels.${constName}`);
        // Handle may be on same line or next line (multiline formatting)
        const handlePattern = new RegExp(`ipcMain\\.handle\\(\\s*IpcChannels\\.${constName}`);
        expect(mainIndexSrc).toMatch(handlePattern);
      });
    }
  });

  describe('all invoke channels are exposed in preload', () => {
    const invokeChannelStrings = [
      'session:create',
      'session:list',
      'session:get',
      'session:rename',
      'session:end',
      'session:switch',
      'pty:write',
      'pty:resize',
      'shell:write',
      'shell:resize',
      'toolkit:list',
      'toolkit:execute',
      'toolkit:save',
      'toolkit:add',
      'toolkit:update',
      'toolkit:delete',
      'app:get-state',
      'app:save-state',
      'app:get-new-session-defaults',
      'dialog:select-directory',
    ];

    for (const channel of invokeChannelStrings) {
      it(`should expose "${channel}" in preload.ts`, () => {
        expect(preloadSrc).toContain(`'${channel}'`);
      });
    }
  });

  describe('all push channels have listeners in preload', () => {
    const pushChannels = [
      'pty:data',
      'shell:data',
      'session:state',
      'menu:new-session',
      'menu:switch-session',
      'menu:prev-session',
      'menu:next-session',
      'menu:close-session',
    ];

    for (const channel of pushChannels) {
      it(`should have ipcRenderer.on for "${channel}" in preload.ts`, () => {
        expect(preloadSrc).toContain(`'${channel}'`);
      });
    }
  });

  describe('ElectronAPI type covers all preload methods', () => {
    // Extract method names from preload.ts
    const preloadMethodRegex = /^\s+(\w+):\s*\(/gm;
    const preloadMethods: string[] = [];
    let match;
    while ((match = preloadMethodRegex.exec(preloadSrc)) !== null) {
      preloadMethods.push(match[1]);
    }

    // Core methods that must be in both preload and electron.d.ts
    const coreMethods = [
      'sessionCreate',
      'sessionList',
      'sessionGet',
      'sessionRename',
      'sessionEnd',
      'sessionSwitch',
      'ptyWrite',
      'ptyResize',
      'shellWrite',
      'shellResize',
      'toolkitList',
      'toolkitExecute',
      'toolkitSave',
      'toolkitAdd',
      'toolkitUpdate',
      'toolkitDelete',
      'appGetState',
      'appSaveState',
      'appGetNewSessionDefaults',
      'selectDirectory',
      'onPtyData',
      'onShellData',
      'onSessionState',
      'onMenuNewSession',
      'onMenuSwitchSession',
      'onMenuCloseSession',
      'onMenuPrevSession',
      'onMenuNextSession',
    ];

    for (const method of coreMethods) {
      it(`should have "${method}" in preload.ts`, () => {
        expect(preloadMethods).toContain(method);
      });

      it(`should have "${method}" in electron.d.ts`, () => {
        expect(electronDts).toContain(method);
      });
    }
  });

  describe('IpcChannels values are unique', () => {
    it('should have no duplicate channel names', () => {
      const values = Object.values(IpcChannels);
      const unique = new Set(values);
      expect(values.length).toBe(unique.size);
    });
  });

  describe('IpcInvokeMap covers all invoke channels', () => {
    // This is a compile-time check — if it compiles, the types are consistent.
    // We verify at runtime that the channel constant values exist.
    it('should have entries for all session channels', () => {
      const invokeKeys: (keyof IpcInvokeMap)[] = [
        'session:create',
        'session:list',
        'session:get',
        'session:rename',
        'session:end',
        'session:switch',
      ];
      for (const key of invokeKeys) {
        expect(Object.values(IpcChannels)).toContain(key);
      }
    });

    it('should have entries for all PTY channels', () => {
      const ptyKeys: (keyof IpcInvokeMap)[] = [
        'pty:write',
        'pty:resize',
        'shell:write',
        'shell:resize',
      ];
      for (const key of ptyKeys) {
        expect(Object.values(IpcChannels)).toContain(key);
      }
    });
  });
});
