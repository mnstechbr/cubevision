const dict = {
  pt: {
    boot: 'inicializando projetor',
    title: 'CubeVision',
    lead: 'Um artefato holográfico. Gire, encontre a fresta e mergulhe.',
    useCamera: 'Usar as mãos (câmera)',
    useMouse: 'Usar mouse',
    useTouch: 'Tocar para começar',
    privacyNote:
      'A imagem da câmera é processada só neste navegador. Nada é enviado, gravado ou guardado. Você pode desligar a qualquer momento.',
    privacy: 'Privacidade',
    cameraOff: 'Desligar câmera',
    cameraOn: 'Ligar câmera',
    lang: 'EN',
    langLabel: 'Switch to English',
    loadingHands: 'carregando reconhecimento de mãos',
    camDenied: 'Câmera indisponível. Seguindo com o mouse.',
    handClose: 'Mão muito perto da câmera. Afaste um pouco (uns 50 cm).',
    handFar: 'Mão muito longe. Chegue um pouco mais perto da câmera.',
    hintMouse: 'Arraste para girar · role para aproximar · clique no ponto que brilha',
    hintTouch: 'Arraste para girar · pinça para aproximar · toque no ponto que brilha',
    hintHands: 'Mova a mão para apontar · leve o cursor até a borda para girar · pare sobre o ponto que brilha para mergulhar',
    hintFind: 'Algo brilha atrás do cubo…',
    layer: 'camada',
    names: {
      table: 'oficina',
      city: 'cidade',
      room: 'sala',
      machine: 'máquina',
      crystal: 'cristal',
      galaxy: 'galáxia',
    },
    reveal: 'Mundos dentro de mundos. Feito pela MNS Tech.',
    revealLink: 'Conheça a MNS Tech',
    sceneLabel: 'Holograma interativo. Camada atual:',
  },
  en: {
    boot: 'initializing projector',
    title: 'CubeVision',
    lead: 'A holographic artifact. Turn it, find the crack, dive in.',
    useCamera: 'Use your hands (camera)',
    useMouse: 'Use mouse',
    useTouch: 'Tap to start',
    privacyNote:
      'Camera images are processed only in this browser. Nothing is sent, recorded or stored. You can turn it off at any time.',
    privacy: 'Privacy',
    cameraOff: 'Turn camera off',
    cameraOn: 'Turn camera on',
    lang: 'PT',
    langLabel: 'Mudar para português',
    loadingHands: 'loading hand tracking',
    camDenied: 'Camera unavailable. Continuing with the mouse.',
    handClose: 'Hand too close to the camera. Move back a little (about 50 cm).',
    handFar: 'Hand too far. Come a little closer to the camera.',
    hintMouse: 'Drag to turn · scroll to zoom · click the glowing spot',
    hintTouch: 'Drag to turn · pinch to zoom · tap the glowing spot',
    hintHands: 'Move your hand to point · take the cursor to an edge to turn · rest on the glowing spot to dive',
    hintFind: 'Something glows behind the cube…',
    layer: 'layer',
    names: {
      table: 'workshop',
      city: 'city',
      room: 'room',
      machine: 'machine',
      crystal: 'crystal',
      galaxy: 'galaxy',
    },
    reveal: 'Worlds within worlds. Made by MNS Tech.',
    revealLink: 'Meet MNS Tech',
    sceneLabel: 'Interactive hologram. Current layer:',
  },
};

export type Lang = keyof typeof dict;
type Strings = (typeof dict)['pt'];

function initial(): Lang {
  const q = new URLSearchParams(location.search).get('lang');
  if (q === 'pt' || q === 'en') return q;
  try {
    const saved = localStorage.getItem('lang');
    if (saved === 'pt' || saved === 'en') return saved;
  } catch {
    /* storage blocked: fall through */
  }
  return navigator.language.toLowerCase().startsWith('pt') ? 'pt' : 'en';
}

let lang: Lang = initial();
const listeners = new Set<() => void>();

export const i18n = {
  get lang() {
    return lang;
  },
  get t(): Strings {
    return dict[lang];
  },
  toggle() {
    lang = lang === 'pt' ? 'en' : 'pt';
    try {
      localStorage.setItem('lang', lang);
    } catch {
      /* fine: just not remembered */
    }
    document.documentElement.lang = lang === 'pt' ? 'pt-BR' : 'en';
    listeners.forEach((f) => f());
  },
  onChange(f: () => void) {
    listeners.add(f);
  },
};
document.documentElement.lang = lang === 'pt' ? 'pt-BR' : 'en';
