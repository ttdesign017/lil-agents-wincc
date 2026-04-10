import React, { useEffect, useState, useCallback } from 'react';
import WalkerCharacter from './components/WalkerCharacter';

function App() {
  const [taskbarInfo, setTaskbarInfo] = useState({
    dockX: 0,
    dockWidth: 0,
    dockTopY: 0,
    screenWidth: 0
  });

  const [showBruce, setShowBruce] = useState(true);
  const [showJazz, setShowJazz] = useState(true);
  const [theme, setTheme] = useState('corporate');

  const getInfo = useCallback(async () => {
    if ((window as any).electronAPI) {
      const info = await (window as any).electronAPI.getTaskbarInfo();
      setTaskbarInfo(info);
    } else {
      setTaskbarInfo({
        dockX: 0,
        dockWidth: window.innerWidth,
        dockTopY: window.innerHeight - 48,
        screenWidth: window.innerWidth
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
    pointerEvents: 'none'
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
      />
      <WalkerCharacter
        name="刘小红"
        sprite="./assets/jazz.png"
        taskbarInfo={taskbarInfo}
        initialProgress={0.7}
        yOffset={0}
        visible={showJazz}
      />
    </div>
  );
}

export default App;
