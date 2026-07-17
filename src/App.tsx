import React, { useEffect, useState, useCallback, useMemo } from 'react';
import WalkerCharacter from './components/WalkerCharacter';

const POSITION_CHANNEL = 'lvyy-character-positions';
const DRAG_CHANNEL = 'lvyy-character-drag';
const POPOVER_CHANNEL = 'lvyy-character-popover';
const LLM_CHANNEL = 'lvyy-character-llm';

function getDisplayIndex(): number {
  const params = new URLSearchParams(window.location.search);
  const idx = params.get('displayIndex');
  return idx ? parseInt(idx, 10) : 0;
}

function App() {
  const displayIndex = useMemo(() => getDisplayIndex(), []);
  const isMaster = displayIndex === 0;

  const [taskbarInfo, setTaskbarInfo] = useState<any>({
    dockX: 0,
    dockWidth: 0,
    dockTopY: 0,
    screenWidth: 0,
    virtualX: 0,
    virtualY: 0,
    virtualWidth: 0,
    virtualHeight: 0,
    displays: [],
  });

  const [showBruce, setShowBruce] = useState(true);
  const [showJazz, setShowJazz] = useState(true);
  const [theme, setTheme] = useState('corporate');
  const [positionChannel, setPositionChannel] = useState<BroadcastChannel | null>(null);
  const [dragChannel, setDragChannel] = useState<BroadcastChannel | null>(null);
  const [popoverChannel, setPopoverChannel] = useState<BroadcastChannel | null>(null);
  const [llmChannel, setLlmChannel] = useState<BroadcastChannel | null>(null);

  useEffect(() => {
    const pc = new BroadcastChannel(POSITION_CHANNEL);
    const dc = new BroadcastChannel(DRAG_CHANNEL);
    const poc = new BroadcastChannel(POPOVER_CHANNEL);
    const lc = new BroadcastChannel(LLM_CHANNEL);
    setPositionChannel(pc);
    setDragChannel(dc);
    setPopoverChannel(poc);
    setLlmChannel(lc);
    return () => {
      pc.close();
      dc.close();
      poc.close();
      lc.close();
    };
  }, []);

  const getInfo = useCallback(async () => {
    if ((window as any).electronAPI) {
      const info = await (window as any).electronAPI.getTaskbarInfo();
      setTaskbarInfo(info);
    } else {
      setTaskbarInfo({
        dockX: 0,
        dockWidth: window.innerWidth,
        dockTopY: window.innerHeight - 48,
        screenWidth: window.innerWidth,
        virtualX: 0,
        virtualY: 0,
        virtualWidth: window.innerWidth,
        virtualHeight: window.innerHeight,
        displays: [{
          x: 0, y: 0,
          width: window.innerWidth, height: window.innerHeight,
          workAreaX: 0, workAreaY: 0,
          workAreaWidth: window.innerWidth, workAreaHeight: window.innerHeight - 48,
          bottomY: window.innerHeight - 48,
        }],
      });
    }
  }, []);

  useEffect(() => {
    document.documentElement.className = `theme-${theme}`;
  }, [theme]);

  useEffect(() => {
    getInfo();
    window.addEventListener('resize', getInfo);

    let offToggle: (() => void) | undefined;
    let offTheme: (() => void) | undefined;
    let offDisplay: (() => void) | undefined;

    if ((window as any).electronAPI) {
      offToggle = (window as any).electronAPI.onToggleVisibility((name: string, visible: boolean) => {
        if (name === '绿油油') setShowBruce(visible);
        if (name === '刘小红') setShowJazz(visible);
      });

      offTheme = (window as any).electronAPI.onThemeChange((newTheme: string) => {
        setTheme(newTheme);
      });

      offDisplay = (window as any).electronAPI.onDisplayChange?.(() => {
        getInfo();
      });
    }

    return () => {
      window.removeEventListener('resize', getInfo);
      offToggle?.();
      offTheme?.();
      offDisplay?.();
    };
  }, [getInfo]);

  const containerStyle: React.CSSProperties = {
    width: '100%',
    height: '100%',
    position: 'relative',
    pointerEvents: 'auto',
    overflow: 'hidden',
  };

  return (
    <div style={containerStyle} className={`theme-${theme}`}>
      <WalkerCharacter
        name="绿油油"
        sprite="./assets/bruce.png"
        taskbarInfo={taskbarInfo}
        initialProgress={0.3}
        yOffset={0}
        visible={showBruce}
        isMaster={isMaster}
        displayIndex={displayIndex}
        positionChannel={positionChannel}
        dragChannel={dragChannel}
        popoverChannel={popoverChannel}
        llmChannel={llmChannel}
        onHide={() => {
          setShowBruce(false);
          (window as any).electronAPI?.setTrayVisibility?.('绿油油', false);
        }}
      />
      <WalkerCharacter
        name="刘小红"
        sprite="./assets/jazz.png"
        taskbarInfo={taskbarInfo}
        initialProgress={0.7}
        yOffset={0}
        visible={showJazz}
        isMaster={isMaster}
        displayIndex={displayIndex}
        positionChannel={positionChannel}
        dragChannel={dragChannel}
        popoverChannel={popoverChannel}
        llmChannel={llmChannel}
        onHide={() => {
          setShowJazz(false);
          (window as any).electronAPI?.setTrayVisibility?.('刘小红', false);
        }}
      />
    </div>
  );
}

export default App;
