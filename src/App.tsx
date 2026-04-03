import React, { useEffect, useState } from 'react';
import WalkerCharacter from './components/WalkerCharacter';

function App() {
  const [isLoaded, setIsLoaded] = useState(false);
  const [isVisible, setIsVisible] = useState(false);
  const [taskbarInfo, setTaskbarInfo] = useState({
    dockX: 0,
    dockWidth: 0,
    dockTopY: 0,
    screenWidth: 0
  });

  const [showBruce, setShowBruce] = useState(true);
  const [showJazz, setShowJazz] = useState(true);
  const [theme, setTheme] = useState('neon');

  const getInfo = async () => {
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
    setIsLoaded(true);
    // Only set visible once to prevent flickering characters on resize
    if (!isVisible) {
      setTimeout(() => setIsVisible(true), 200);
    }
  };

  useEffect(() => {
    getInfo();
    window.addEventListener('resize', getInfo);
    
    let offToggle: (() => void) | undefined;
    let offTheme: (() => void) | undefined;
    
    if ((window as any).electronAPI) {
      offToggle = (window as any).electronAPI.onToggleVisibility((name: string, visible: boolean) => {
        if (name === '绿油油') setShowBruce(visible);
        if (name === '刘小红') setShowJazz(visible);
      });

      offTheme = (window as any).electronAPI.onThemeChange((newTheme: string) => {
        setTheme(newTheme);
      });
    }

    return () => {
      window.removeEventListener('resize', getInfo);
      offToggle?.();
      offTheme?.();
    };
  }, [isVisible]); // Add isVisible as dependency for the update check

  const containerStyle: React.CSSProperties = {
    width: '100%',
    height: '100%',
    position: 'relative',
    pointerEvents: 'none'
  };

  if (!isLoaded || !isVisible) return null;

  return (
    <div style={containerStyle} className={`theme-${theme}`}>
      <WalkerCharacter 
        key="bruce-green"
        name="绿油油"
        sprite="./assets/bruce.png"
        taskbarInfo={taskbarInfo}
        positionProgress={0.3}
        yOffset={0}
        visible={showBruce}
      />
      <WalkerCharacter 
        key="jazz-red"
        name="刘小红"
        sprite="./assets/jazz.png"
        taskbarInfo={taskbarInfo}
        positionProgress={0.7}
        yOffset={0}
        visible={showJazz}
      />
    </div>
  );
}

export default App;
