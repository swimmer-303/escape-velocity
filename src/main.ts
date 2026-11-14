// Written with AI assistance (Claude Code). See README "Use of AI tools".
import './ui/style.css';
import { App } from './ui/app';
import { CssStage, SwappableStage } from './render/stage';
import { dashboardParams } from './class/protocol';

const stage = new SwappableStage(new CssStage());
new App(stage);

function want3d(): boolean {
  try {
    return JSON.parse(localStorage.getItem('ev-settings') ?? '{}').view3d !== false;
  } catch {
    return true;
  }
}

// Load the 3D outpost in the background so the title screen appears right away.
// (Not on the teacher dashboard page: the game is hidden there.)
if (want3d() && !dashboardParams(location.search)) {
  import('./render/three-stage')
    .then(({ ThreeStage }) => {
      if (!ThreeStage.supported()) return;
      const three = new ThreeStage();
      // If the GPU can't handle it, quietly go back to the simple view.
      let failed = false;
      three.onFail = () => {
        if (failed) return;
        failed = true;
        setTimeout(() => stage.swap(new CssStage()), 0);
      };
      stage.swap(three);
    })
    .catch((e) => console.warn('3D view unavailable, using the simple view.', e));
}
