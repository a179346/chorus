import { describe, it, expect } from 'vitest';
import type {
  Session,
  SessionConfig,
  SessionStatus,
  SessionStateUpdate,
  PersistedSession,
  ToolkitCommand,
  AppState,
  WindowBounds,
  PanelSizes,
  NewSessionDefaults,
  PtyDataPayload,
  PtyWritePayload,
  PtyResizePayload,
  SessionIdPayload,
  SessionRenamePayload,
  SessionSwitchByIndexPayload,
  ToolkitExecutePayload,
  ToolkitListPayload,
  ToolkitSavePayload,
  IpcError,
} from '../src/shared/types';

describe('Data Model Validation', () => {
  describe('Session', () => {
    it('should accept valid session data', () => {
      const session: Session = {
        id: 'uuid-123',
        name: 'My Session',
        cwd: '/Users/test/project',
        worktree: null,
        status: 'idle',
        model: 'claude-sonnet-4-6',
        contextUsage: 42,
        gitBranch: 'main',
        flags: ['--enable-auto-mode'],
        createdAt: Date.now(),
        lastActiveAt: Date.now(),
      };
      expect(session.id).toBe('uuid-123');
      expect(session.status).toBe('idle');
    });

    it('should accept all valid status values', () => {
      const validStatuses: SessionStatus[] = [
        'creating',
        'idle',
        'thinking',
        'generating',
        'error',
        'ended',
      ];
      for (const status of validStatuses) {
        const session: Session = {
          id: '1',
          name: 'test',
          cwd: '/tmp',
          worktree: null,
          status,
          model: null,
          contextUsage: null,
          gitBranch: null,
          flags: [],
          createdAt: 0,
          lastActiveAt: 0,
        };
        expect(session.status).toBe(status);
      }
    });

    it('should allow null for optional fields', () => {
      const session: Session = {
        id: '1',
        name: 'test',
        cwd: '/tmp',
        worktree: null,
        status: 'idle',
        model: null,
        contextUsage: null,
        gitBranch: null,
        flags: [],
        createdAt: 0,
        lastActiveAt: 0,
      };
      expect(session.model).toBeNull();
      expect(session.contextUsage).toBeNull();
      expect(session.gitBranch).toBeNull();
      expect(session.worktree).toBeNull();
    });
  });

  describe('SessionConfig', () => {
    it('should accept config with required fields only', () => {
      const config: SessionConfig = {
        name: 'New Session',
        cwd: '/tmp/project',
        flags: [],
      };
      expect(config.worktree).toBeUndefined();
    });

    it('should accept config with optional worktree', () => {
      const config: SessionConfig = {
        name: 'New Session',
        cwd: '/tmp/project',
        worktree: 'feature-branch',
        flags: ['--enable-auto-mode'],
      };
      expect(config.worktree).toBe('feature-branch');
    });
  });

  describe('PersistedSession', () => {
    it('should have subset of Session fields (no runtime state)', () => {
      const persisted: PersistedSession = {
        id: 'uuid-123',
        name: 'My Session',
        cwd: '/tmp/project',
        worktree: null,
        flags: [],
        model: 'claude-opus-4-6',
        contextUsage: 42,
        createdAt: 1000,
        lastActiveAt: 2000,
      };
      // PersistedSession should NOT have status or gitBranch
      expect(persisted).not.toHaveProperty('status');
      expect(persisted).not.toHaveProperty('gitBranch');
      expect(persisted.model).toBe('claude-opus-4-6');
      expect(persisted.contextUsage).toBe(42);
    });
  });

  describe('SessionStateUpdate', () => {
    it('should allow partial updates', () => {
      const update: SessionStateUpdate = {
        sessionId: 'uuid-123',
        status: 'thinking',
      };
      expect(update.model).toBeUndefined();
    });

    it('should allow all fields', () => {
      const update: SessionStateUpdate = {
        sessionId: 'uuid-123',
        status: 'generating',
        model: 'claude-opus-4-6',
        contextUsage: 75,
        gitBranch: 'feature/new',
      };
      expect(update.contextUsage).toBe(75);
    });
  });

  describe('ToolkitCommand', () => {
    it('should accept a command', () => {
      const cmd: ToolkitCommand = {
        id: 'cmd-1',
        label: 'Run Tests',
        command: '/test',
      };
      expect(cmd.label).toBe('Run Tests');
    });

    it('should accept a command with icon', () => {
      const cmd: ToolkitCommand = {
        id: 'cmd-2',
        label: 'Deploy',
        command: '/deploy',
        icon: 'server',
      };
      expect(cmd.icon).toBe('server');
    });
  });

  describe('AppState', () => {
    it('should have all required fields', () => {
      const state: AppState = {
        windowBounds: { x: 100, y: 100, width: 1400, height: 900 },
        panelSizes: { sidebarWidth: 350, shellHeight: 200, toolkitHeight: 200, shellCollapsed: false },
        lastActiveSessionId: null,
        newSessionDefaults: { cwd: '/Users/test', flags: [] },
      };
      expect(state.windowBounds.width).toBe(1400);
      expect(state.panelSizes.shellCollapsed).toBe(false);
    });
  });

  describe('IPC Payloads', () => {
    it('should validate PtyDataPayload', () => {
      const payload: PtyDataPayload = { sessionId: 'abc', data: 'hello' };
      expect(payload.sessionId).toBe('abc');
    });

    it('should validate PtyWritePayload', () => {
      const payload: PtyWritePayload = { sessionId: 'abc', data: 'input' };
      expect(payload.data).toBe('input');
    });

    it('should validate PtyResizePayload', () => {
      const payload: PtyResizePayload = { sessionId: 'abc', cols: 80, rows: 24 };
      expect(payload.cols).toBe(80);
      expect(payload.rows).toBe(24);
    });

    it('should validate SessionIdPayload', () => {
      const payload: SessionIdPayload = { id: 'session-123' };
      expect(payload.id).toBe('session-123');
    });

    it('should validate SessionRenamePayload', () => {
      const payload: SessionRenamePayload = { id: 'session-123', name: 'New Name' };
      expect(payload.name).toBe('New Name');
    });

    it('should validate SessionSwitchByIndexPayload', () => {
      const payload: SessionSwitchByIndexPayload = { index: 3 };
      expect(payload.index).toBe(3);
    });

    it('should validate ToolkitExecutePayload', () => {
      const payload: ToolkitExecutePayload = { sessionId: 's1', commandId: 'cmd1' };
      expect(payload.commandId).toBe('cmd1');
    });

    it('should validate ToolkitListPayload', () => {
      const payload: ToolkitListPayload = { sessionId: 's1' };
      expect(payload.sessionId).toBe('s1');
    });

    it('should validate ToolkitSavePayload', () => {
      const payload: ToolkitSavePayload = {
        commands: [{ id: '1', label: 'Test', command: '/test' }],
      };
      expect(payload.commands).toHaveLength(1);
    });

    it('should validate IpcError', () => {
      const err: IpcError = { code: 'SESSION_NOT_FOUND', message: 'Not found' };
      expect(err.code).toBe('SESSION_NOT_FOUND');
    });
  });
});
