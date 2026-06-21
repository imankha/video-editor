// "Claude Container" — a typed Command Palette command (Ctrl+Shift+P ->
// "Claude Container") that launches the repo's on-demand, bypass-permissions
// Claude Code session inside Docker.
//
// It's intentionally thin: it just runs the "Claude Container" task defined in
// .vscode/tasks.json, so the actual launch logic (and its cross-platform shell
// handling) lives in exactly one place.
const vscode = require('vscode');

function activate(context) {
  context.subscriptions.push(
    vscode.commands.registerCommand('claude-container.launch', async () => {
      let tasks;
      try {
        tasks = await vscode.tasks.fetchTasks();
      } catch (err) {
        vscode.window.showErrorMessage('Claude Container: failed to read tasks — ' + err);
        return;
      }
      const task = tasks.find((t) => t.name === 'Claude Container');
      if (!task) {
        vscode.window.showErrorMessage(
          "Claude Container: couldn't find the 'Claude Container' task. Open the video-editor folder (it ships .vscode/tasks.json)."
        );
        return;
      }
      await vscode.tasks.executeTask(task);
    })
  );
}

function deactivate() {}

module.exports = { activate, deactivate };
