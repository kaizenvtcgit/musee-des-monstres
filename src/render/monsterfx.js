// The sounds of the heavy and cold monsters (golem, yeti), on the moments of their animations (a foot
// landing, a slam, a snore...: src/config/anim-events/*-events.json, played by src/render/GameScene.js).

const HEAVY = { step: 'step', slam: 'slam', debris: 'clack', pebbles: 'pebbles', beat: 'beat', rumble: 'rumble', grind: 'grind' };

// The sounds of event `type` ([[sound, gain]...]); `cold`: a yeti, `snowy`: on snowy ground.
export function eventSounds(type, { cold = false, snowy = false } = {}) {
  if (cold) {
    const sound = {
      pad: snowy ? 'snowStep' : 'pad', padRun: snowy ? 'snowStep' : 'pad', breath: 'breath', snore: 'snore', roar: 'roar',
      happy: 'happy', grunt: 'grunt', beat: 'pad', furRub: 'furRub', furShake: 'furRub', // a furry chest: a muffled thump
    }[type];
    return sound ? [[sound, type === 'padRun' ? 1.2 : 1]] : [];
  }
  const out = HEAVY[type] ? [[HEAVY[type], 1]] : [];
  if (type === 'step' && Math.random() < 0.3) out.push(['grind', 0.5]); // stone rubbing as it moves
  return out;
}
