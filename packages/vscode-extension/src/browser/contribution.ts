import { FeatureExtensionCapabilityContribution, FeatureExtensionCapabilityRegistry, IFeatureExtension, FeatureExtensionManagerService } from '@ali/ide-feature-extension/lib/browser';
import { Domain, CommandContribution, CommandRegistry, AppConfig } from '@ali/ide-core-browser';
import { Autowired, INJECTOR_TOKEN, Injector } from '@ali/common-di';
import { VscodeExtensionType } from './vscode.extension';
import { LANGUAGE_BUNDLE_FIELD, VSCodeExtensionService } from './types';
import { ActivationEventService } from '@ali/ide-activation-event';
import { WorkspaceService } from '@ali/ide-workspace/lib/browser/workspace-service';

@Domain(FeatureExtensionCapabilityContribution, CommandContribution)
export class VsodeExtensionContribution implements FeatureExtensionCapabilityContribution, CommandContribution {

  @Autowired()
  vscodeExtensionType: VscodeExtensionType;

  @Autowired()
  activationEventService: ActivationEventService;

  @Autowired(INJECTOR_TOKEN)
  injector: Injector;

  @Autowired(WorkspaceService)
  protected readonly workspaceService: WorkspaceService;
  @Autowired(AppConfig)
  private appConfig: AppConfig;

  async registerCapability(registry: FeatureExtensionCapabilityRegistry) {

    if (this.appConfig.extensionDir) {
      registry.addFeatureExtensionScanDirectory(this.appConfig.extensionDir);
    }
    registry.addExtraMetaData(LANGUAGE_BUNDLE_FIELD, './package.nls.' /* 'zh-cn' */ + 'json');
    registry.registerFeatureExtensionType(this.vscodeExtensionType);

  }

  async onWillEnableFeatureExtensions(extensionService: FeatureExtensionManagerService) {
    const service =  this.injector.get(VSCodeExtensionService); // new VSCodeExtensionService(extensionService)
    await this.workspaceService.init();
    await service.createExtensionHostProcess();
  }

  registerCommands(commandRegistry: CommandRegistry): void {
    commandRegistry.beforeExecuteCommand(async (command, args) => {
      await this.activationEventService.fireEvent('onCommand', command);
      return args;
    });
  }

}
