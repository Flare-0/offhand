import { describe, expect, it } from 'vitest';
import { validateExecuteScript } from '../src/server/tools/execute.js';

describe('execute script sanitization', () => {
  it('allows safe After Effects ExtendScript', () => {
    expect(() => validateExecuteScript('app.project.activeItem.time')).not.toThrow();
    expect(() => validateExecuteScript('var c = app.project.activeItem; c.name;')).not.toThrow();
  });

  it('blocks shell execution, sockets, ExternalObject, and BridgeTalk', () => {
    expect(() => validateExecuteScript('system.callSystem("calc.exe")')).toThrow(/callSystem/);
    expect(() => validateExecuteScript('new ExternalObject("lib:test")')).toThrow(/ExternalObject/);
    expect(() => validateExecuteScript('var s = new Socket();')).toThrow(/Socket/);
    expect(() => validateExecuteScript('var bt = new BridgeTalk();')).toThrow(/BridgeTalk/);
  });

  it('blocks file execution, file writes, eval, and app exit', () => {
    expect(() => validateExecuteScript('new File("C:/evil.bat").execute()')).toThrow(/execute/);
    expect(() => validateExecuteScript('var f = new File("a.txt"); f.open("w");')).toThrow(/open/);
    expect(() => validateExecuteScript('$.evalFile("C:/other.jsx")')).toThrow(/evalFile/);
    expect(() => validateExecuteScript('eval("1 + 1")')).toThrow(/eval/);
    expect(() => validateExecuteScript('app.quit()')).toThrow(/exit|quit/);
    expect(() => validateExecuteScript('app.project.close(CloseOptions.DO_NOT_SAVE_CHANGES)')).toThrow(/close/);
  });

  it('still blocks unsafe calls hidden after comments', () => {
    expect(() =>
      validateExecuteScript('/* safe comment */\n// another\nsystem.callSystem("whoami")'),
    ).toThrow(/callSystem/);
  });
});
