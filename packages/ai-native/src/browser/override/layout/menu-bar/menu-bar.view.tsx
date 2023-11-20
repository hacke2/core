import clsx from 'classnames';
import * as React from 'react';

import { AppConfig, getIcon, useInjectable, SlotRenderer } from '@opensumi/ide-core-browser';
import { Button, Icon } from '@opensumi/ide-core-browser/lib/components';
import { LAYOUT_VIEW_SIZE } from '@opensumi/ide-core-browser/lib/layout/constants';
import { VIEW_CONTAINERS } from '@opensumi/ide-core-browser/lib/layout/view-id';
import { AbstractContextMenuService, ICtxMenuRenderer, MenuId } from '@opensumi/ide-core-browser/lib/menu/next';
import { CommandService } from '@opensumi/ide-core-common';

import { AI_RUN_DEBUG_COMMANDS } from '../../../../common/command';
import { AILogoAvatar, EnhanceIcon } from '../../../components/Icon';
import { AI_MENU_BAR_LEFT, AI_MENU_BAR_RIGHT } from '../layout-config';

import * as styles from './menu-bar.module.less';
import { AiMenubarService } from './menu-bar.service';

const AiMenuBarRender = () => {
  const contextmenuService = useInjectable<AbstractContextMenuService>(AbstractContextMenuService);
  const ctxMenuRenderer = useInjectable<ICtxMenuRenderer>(ICtxMenuRenderer);

  const iconRef = React.useRef<HTMLDivElement | null>(null);
  const [anchor, setAnchor] = React.useState<{ x: number; y: number } | undefined>(undefined);

  React.useEffect(() => {
    if (iconRef.current) {
      const rect = iconRef.current.getBoundingClientRect();
      const { x, y, height } = rect;

      setAnchor({
        x,
        y: y + height + 4,
      });
    }
  }, [iconRef.current]);

  const extraTopMenus = React.useMemo(
    () =>
      contextmenuService.createMenu({
        id: MenuId.AiMenuBarTopExtra,
      }),
    [contextmenuService],
  );

  const handleClick = React.useCallback(() => {
    if (!anchor) {
      return;
    }

    const menuNodes = extraTopMenus.getMergedMenuNodes();
    extraTopMenus.dispose();

    ctxMenuRenderer.show({
      anchor,
      menuNodes,
    });
  }, [anchor, extraTopMenus]);

  return (
    <>
      <EnhanceIcon className={styles.extra_top_icon} ref={iconRef} onClick={handleClick}>
        <Icon className={clsx(getIcon('caret-right'), styles.caret_icon)} />
      </EnhanceIcon>
    </>
  );
};

export const AiMenuBarView = () => {
  const commandService = useInjectable<CommandService>(CommandService);
  const aiMenubarService = useInjectable<AiMenubarService>(AiMenubarService);
  const appConfig = useInjectable<AppConfig>(AppConfig);

  const [isOpen, setIsOpen] = React.useState<boolean>(true);

  const handleRun = () => {
    commandService.executeCommand(AI_RUN_DEBUG_COMMANDS.id);
  };

  const handleRightPanel = () => {
    aiMenubarService.toggleRightPanel();
  };

  React.useEffect(() => {
    const dispose = aiMenubarService.onDidChangeDispatcher.on('latestWidth')((data: number) => {
      if (!data) {
        setIsOpen(true);
      } else {
        setIsOpen(false);
      }
    });
    return () => dispose.dispose();
  }, [aiMenubarService]);

  const MENUBAR_HEIGHT = React.useMemo(
    () => appConfig.layoutViewSize?.MENUBAR_HEIGHT || LAYOUT_VIEW_SIZE.MENUBAR_HEIGHT,
    [appConfig],
  );

  const handleLeftMenuVisiable = React.useCallback(() => {
    commandService.executeCommand('main-layout.left-panel.toggle');
  }, []);

  return (
    <div id={VIEW_CONTAINERS.MENUBAR} className={styles.menu_bar_view} style={{ height: MENUBAR_HEIGHT }}>
      <div className={styles.container}>
        <div className={styles.left}>
          <EnhanceIcon icon={'left-nav-open'} onClick={handleLeftMenuVisiable} />
          <div className={styles.top_menus_bar}>
            <AiMenuBarRender />
          </div>
          <SlotRenderer slot={AI_MENU_BAR_LEFT} flex={1} overflow={'initial'} />
        </div>
        <div className={styles.center}>
          <div className={styles.run}>
            <Button size={'default'} onClick={handleRun} className={styles.btn}>
              <Icon className={getIcon('caret-right')} /> 运行
            </Button>
          </div>
        </div>
        <div className={styles.right}>
          <SlotRenderer slot={AI_MENU_BAR_RIGHT} flex={1} overflow={'initial'} />
          {/* <div className={styles.input}>
            <Input
              className={styles.input_wrapper}
              width={'100%'}
              addonBefore={<Icon style={{ color: '#ffffff1f' }} className={getIcon('search')} />}
              placeholder='请搜索并选择指令'
            ></Input>
          </div> */}
          <div className={clsx(styles.ai_switch, isOpen ? '' : styles.closed)} onClick={handleRightPanel}>
            <AILogoAvatar iconClassName={styles.avatar_icon_large} />
          </div>
        </div>
      </div>
    </div>
  );
};
