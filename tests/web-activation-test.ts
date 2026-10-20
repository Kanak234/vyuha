/**
 * Simple web extension activation test
 * Verifies the web extension loads without errors
 */
import * as vscode from 'vscode';

async function run() {
  console.log('Testing VYUHA web extension activation...');
  
  // Check that the extension is activated
  const ext = vscode.extensions.getExtension('KANAKPRABHAKAR.vyuha');
  if (!ext) {
    console.error('FAIL: Extension not found');
    process.exit(1);
  }
  console.log('Extension found:', ext.id, ext.packageJSON.version);
  
  // Activate the extension
  await ext.activate();
  console.log('Extension activated successfully');
  
  // Check that web-compatible commands are registered
  const commands = await vscode.commands.getCommands(true);
  const vyuhaCommands = commands.filter(c => c.startsWith('vyuha.'));
  console.log('VYUHA commands registered:', vyuhaCommands.length);
  
  // Verify key web commands exist
  const requiredCommands = [
    'vyuha.open',
    'vyuha.runInference',
    'vyuha.newInput',
    'vyuha.tracePath',
    'vyuha.exportTrace',
    'vyuha.fetchLiveTrace',
    'vyuha.newSpecFile',
    'vyuha.focusLayer',
    'vyuha.revealLayer',
    'vyuha.addHelperLibrary',
    'vyuha.openExample',
    'vyuha.exportGif',
  ];
  
  for (const cmd of requiredCommands) {
    if (!vyuhaCommands.includes(cmd)) {
      console.error('FAIL: Missing required command:', cmd);
      process.exit(1);
    }
  }
  console.log('All required web commands present');
  
  // Verify Node-only commands are NOT registered
  const forbiddenCommands = [
    'vyuha.runAndVisualize',
    'vyuha.visualizeCompilation',
    'vyuha.debugVisualize',
    'vyuha.runSelection',
    'vyuha.runByLanguage',
    'vyuha.stopRun',
    'vyuha.rerun',
    'vyuha.showOutput',
    'vyuha.openCompileArtifact',
  ];
  
  for (const cmd of forbiddenCommands) {
    if (vyuhaCommands.includes(cmd)) {
      console.error('FAIL: Forbidden command should not exist on web:', cmd);
      process.exit(1);
    }
  }
  console.log('No forbidden (Node-only) commands present');
  
  // Check views
  const treeView = vscode.window.createTreeView('vyuha.layers', {
    treeDataProvider: { getChildren: () => [], getTreeItem: () => new vscode.TreeItem('test') }
  });
  treeView.dispose();
  console.log('Tree view registration works');
  
  console.log('\n✅ All web extension tests passed!');
  process.exit(0);
}

run().catch(err => {
  console.error('Test failed:', err);
  process.exit(1);
});