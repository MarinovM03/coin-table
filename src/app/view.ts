import type { BalanceBar } from '../scene/balanceBar';
import type { CameraRig } from '../scene/cameraRig';
import type { Coins } from '../scene/coins';
import type { Fx } from '../scene/fx';
import type { Stage } from '../scene/stage';
import type { World } from '../scene/world';
import type { Hud } from '../ui/hud';

/** Everything on screen that the app drives: the 3D scene and the HUD. */
export interface View {
  readonly stage: Stage;
  readonly rig: CameraRig;
  readonly world: World;
  readonly fx: Fx;
  readonly bar: BalanceBar;
  readonly coins: Coins;
  readonly hud: Hud;
}
