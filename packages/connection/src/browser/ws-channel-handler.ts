import { uuid } from '@opensumi/ide-core-common';
import { IReporterService, REPORT_NAME } from '@opensumi/ide-core-common';

import { NetSocketConnection } from '../common/connection';
import { ReconnectingWebSocketConnection } from '../common/connection/drivers/reconnecting-websocket';
import { WSCloseInfo, ConnectionInfo } from '../common/utils';
import { WSChannel, stringify, parse } from '../common/ws-channel';

/**
 * 前台链接管理类
 */
export class WSChannelHandler {
  private channelMap: Map<string, WSChannel> = new Map();
  private channelCloseEventMap: Map<string, WSCloseInfo> = new Map();
  private logger = console;
  public clientId: string;
  private heartbeatMessageTimer: NodeJS.Timer | null;
  private reporterService: IReporterService;

  get LOG_TAG() {
    return `[WSChannelHandler] [client-id:${this.clientId}]`;
  }

  constructor(
    public connection: ReconnectingWebSocketConnection | NetSocketConnection,
    logger: any,
    clientId?: string,
  ) {
    this.logger = logger || this.logger;
    this.clientId = clientId || `CLIENT_ID_${uuid()}`;
  }
  // 为解决建立连接之后，替换成可落盘的 logger
  replaceLogger(logger: any) {
    if (logger) {
      this.logger = logger;
    }
  }
  setReporter(reporterService: IReporterService) {
    this.reporterService = reporterService;
  }
  private clientMessage() {
    this.connection.send(
      stringify({
        kind: 'client',
        id: this.clientId,
      }),
    );
  }
  private heartbeatMessage() {
    if (this.heartbeatMessageTimer) {
      clearTimeout(this.heartbeatMessageTimer);
    }
    this.heartbeatMessageTimer = global.setTimeout(() => {
      const msg = stringify({
        kind: 'heartbeat',
        id: this.clientId,
      });
      this.connection.send(msg);
      this.heartbeatMessage();
    }, 5000);
  }

  public async initHandler() {
    this.connection.onMessage((message) => {
      // 一个心跳周期内如果有收到消息，则不需要再发送心跳
      this.heartbeatMessage();

      const msg = parse(message);
      if (msg.kind === 'heartbeat') {
        // 不处理心跳消息
        return;
      }

      if (msg.id) {
        const channel = this.channelMap.get(msg.id);
        if (channel) {
          if (msg.kind === 'data' && !channel.hasMessageListener()) {
            // 要求前端发送初始化消息，但后端最先发送消息时，前端并未准备好
            this.logger.error(this.LOG_TAG, 'channel not ready!', msg);
          }
          channel.handleMessage(msg);
        } else {
          this.logger.warn(this.LOG_TAG, `channel ${msg.id} not found`);
        }
      }
    });
    const onOpen1 = () => {
      this.clientMessage();
      this.heartbeatMessage();
    };

    const onOpen2 = () => {
      // 重连 channel
      if (this.channelMap.size) {
        this.channelMap.forEach((channel) => {
          channel.onOpen(() => {
            const closeInfo = this.channelCloseEventMap.get(channel.id);
            this.reporterService &&
              this.reporterService.point(REPORT_NAME.CHANNEL_RECONNECT, REPORT_NAME.CHANNEL_RECONNECT, closeInfo);
            this.logger.log(this.LOG_TAG, `channel reconnect ${this.clientId}:${channel.channelPath}`);
          });

          channel.open(channel.channelPath);
          // 针对前端需要重新设置下后台状态的情况
          channel.fireReOpen();
        });
      }
    };
    await new Promise<void>((resolve) => {
      if (this.connection.isOpen()) {
        onOpen1();
        resolve();
        onOpen2();
      }

      this.connection.onOpen(() => {
        onOpen1();
        resolve();
        onOpen2();
      });

      this.connection.onceClose((code, reason) => {
        if (this.channelMap.size) {
          this.channelMap.forEach((channel) => {
            channel.close(code ?? 1000, reason ?? '');
          });
        }
      });
    });
  }
  public async openChannel(channelPath: string) {
    const channelId = `${this.clientId}:${channelPath}`;
    const channel = new WSChannel(this.connection, {
      id: channelId,
      logger: this.logger,
      tag: 'browser-ws-client-handler',
    });
    this.channelMap.set(channel.id, channel);

    await new Promise<void>((resolve) => {
      channel.onOpen(() => {
        resolve();
      });
      channel.onClose((code: number, reason: string) => {
        this.channelCloseEventMap.set(channelId, {
          channelPath,
          closeEvent: { code, reason },
          connectInfo: (navigator as any).connection as ConnectionInfo,
        });
        this.logger.log(this.LOG_TAG, 'channel close: ', code, reason);
      });
      channel.open(channelPath);
    });

    return channel;
  }

  public dispose() {
    if (this.heartbeatMessageTimer) {
      clearTimeout(this.heartbeatMessageTimer);
    }
  }
}
