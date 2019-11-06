
import { Injectable, Autowired } from '@ali/common-di';
import { IBreadCrumbService, IBreadCrumbPart, IBreadCrumbProvider, EditorSelectionChangeEvent } from '../types';
import { IDisposable, URI, addElement, Emitter, CommandService, localize, WithEventBus, CancellationToken, CancellationTokenSource, MaybeNull, IRange, BasicEvent, OnEvent, EDITOR_COMMANDS, IPosition } from '@ali/ide-core-browser';
import { observable } from 'mobx';
import { IFileServiceClient } from '@ali/ide-file-service/lib/common/file-service-client';
import { IWorkspaceService } from '@ali/ide-workspace/lib/common';
import { workspace } from 'vscode';
import { Path } from '@ali/ide-core-common/lib/path';
import { LabelService } from '@ali/ide-core-browser/lib/services';
import { FileStat } from '@ali/ide-file-service/lib/common';
import { IEditorDocumentModelService, EditorDocumentModelContentChangedEvent } from '../doc-model/types';
import { WorkbenchEditorService, IEditor } from '../../common';
import { DocumentSymbolChangedEvent, DocumentSymbol, DocumentSymbolStore } from './document-symbol';
import debounce = require('lodash.debounce');
import { getIcon, getSymbolIcon } from '@ali/ide-core-browser/lib/icon';

@Injectable()
export class DefaultBreadCrumbProvider extends WithEventBus implements IBreadCrumbProvider {

  private _onDidUpdateBreadCrumb = new Emitter<URI>();
  public onDidUpdateBreadCrumb = this._onDidUpdateBreadCrumb.event;

  @Autowired(IFileServiceClient)
  fileServiceClient: IFileServiceClient;

  @Autowired(IWorkspaceService)
  workspaceService: IWorkspaceService;

  @Autowired(LabelService)
  labelService: LabelService;

  @Autowired(CommandService)
  commandService: CommandService;

  @Autowired()
  documentSymbolStore: DocumentSymbolStore;

  private debouncedFireUriEvent = new Map<string, () => any>();

  handlesUri(uri: URI): boolean {
    // TODO;
    return uri.scheme === 'file';
  }

  provideBreadCrumbForUri(uri: URI, editor: MaybeNull<IEditor>): IBreadCrumbPart[] {
    return this.getFileParts(uri).concat(this.getDocumentSymbolParts(uri, editor));
  }

  private getFileParts(uri: URI): IBreadCrumbPart[] {
    const workspaceRoot: URI | undefined = this.workspaceService.workspace ? new URI(this.workspaceService.workspace.uri)  : undefined;
    let root: URI;
    let relativePaths: Path;
    if (workspaceRoot && workspaceRoot.isEqualOrParent(uri)) {
      root = workspaceRoot;
      relativePaths = workspaceRoot.relative(uri)!;
    } else {
      root = URI.from({
        scheme: uri.scheme,
        authority: uri.authority,
      });
      relativePaths = uri.path;
    }

    let p = root.path;
    const result: IBreadCrumbPart[] = [];
    for (const r of relativePaths.toString().split(Path.separator).filter((p) => !!p)) {
      p = p.join(r);
      const u = root.withPath(p);
      result.push(this.createFilePartBreadCrumbUri(u,  !u.isEqual(uri)));
    }
    return result;
  }

  private createFilePartBreadCrumbUri(uri: URI, isDirectory: boolean): IBreadCrumbPart {
    const res: IBreadCrumbPart = {
      name: uri.path.base,
      icon: this.labelService.getIcon(uri, {isDirectory}),
      getSiblings: async () => {
        const parentDir = URI.from({
          scheme: uri.scheme,
        }).withPath(uri.path.dir);
        const stat = await this.fileServiceClient.getFileStat(parentDir.toString());
        const parts: IBreadCrumbPart[] = [];
        let currentIndex = -1;
        if (stat && stat.children && stat.children.length > 0) {
          sortByNumeric(stat.children).forEach((file, i) => {
              parts.push(this.createFilePartBreadCrumbUri(new URI(file.uri), file.isDirectory));
              if (currentIndex === -1 && uri.toString() === file.uri) {
                currentIndex = i;
              }
          });
        }
        return {
          parts,
          currentIndex,
        };
      },
    };

    if (isDirectory) {
      res.getChildren = async () => {
        const stat = await this.fileServiceClient.getFileStat(uri.toString());
        const parts: IBreadCrumbPart[] = [];
        if (stat && stat.children && stat.children.length > 0) {
          sortByNumeric(stat.children).forEach((file, i) => {
              parts.push(this.createFilePartBreadCrumbUri(new URI(file.uri), file.isDirectory));
          });
        }
        return parts;
      };
    } else {
      res.onClick = () => {
        this.commandService.executeCommand(EDITOR_COMMANDS.OPEN_RESOURCE.id, uri);
      };
    }

    return res;
  }

  private getDocumentSymbolParts(uri: URI, editor: MaybeNull<IEditor>): IBreadCrumbPart[] {
    if (!editor) {
      return [];
    }
    const symbols = this.documentSymbolStore.getDocumentSymbol(uri);
    if (symbols && symbols.length > 0) {
      normalizeDocumentSymbols(symbols, {children: symbols});
      const currentSymbols = this.findCurrentDocumentSymbol(symbols, editor.monacoEditor.getPosition());
      if (currentSymbols.length > 0) {
        return currentSymbols.map((symbol) => this.createFromDocumentSymbol(symbol, editor));
      } else {
        return [
          {
            name: '...',
            getSiblings: () => {
              return {
                parts: symbols.sort((a, b) => {
                  return sortByRangeStart(a.range, b.range);
                }).map((symbol) => this.createFromDocumentSymbol(symbol, editor)),
                currentIndex: -1,
              };
            },
          },
        ];
      }
    } else {
      return [];
    }
  }

  private findCurrentDocumentSymbol(documentSymbols: DocumentSymbol[], position: MaybeNull<IPosition>): DocumentSymbol[] {
    const result: DocumentSymbol[] = [];
    if (!position) {
      return result;
    }
    let toFindIn: DocumentSymbol[] | undefined  = documentSymbols;
    while (toFindIn && toFindIn.length > 0) {
      let found = false;
      for (const documentSymbol of toFindIn) {
        if (positionInRange(position, documentSymbol.range)) {
          result.push(documentSymbol);
          toFindIn = documentSymbol.children;
          found = true;
          break;
        }
      }
      if (!found) {
        break;
      }
    }
    return result;
  }

  private createFromDocumentSymbol(documentSymbol: DocumentSymbol, editor: IEditor): IBreadCrumbPart {
    const symbol = documentSymbol as INormalizedDocumentSymbol;
    const res: IBreadCrumbPart = {
      name: documentSymbol.name,
      icon: getSymbolIcon(symbol.kind),
      onClick: () => {
        editor.setSelection({
          startColumn: symbol.range.startColumn,
          endColumn: symbol.range.startColumn,
          startLineNumber: symbol.range.startLineNumber,
          endLineNumber: symbol.range.startLineNumber,
        });
        editor.monacoEditor.revealRangeInCenter(symbol.range);
        editor.monacoEditor.focus();
      },
    };
    if (symbol.parent) {
      res.getSiblings = () => {
        return {
          parts: symbol.parent!.children!.sort((a, b) => {
            return sortByRangeStart(a.range, b.range);
          }).map((symbol) => this.createFromDocumentSymbol(symbol, editor)),
          currentIndex: symbol.parent!.children!.indexOf(symbol),
        };
      };
    }
    if (symbol.children && symbol.children.length > 0) {
      res.getChildren = () => {
        return symbol.children!.sort((a, b) => {
          return sortByRangeStart(a.range, b.range);
        }).map((symbol) => this.createFromDocumentSymbol(symbol, editor));
      };
    }
    return res;
  }

  @OnEvent(DocumentSymbolChangedEvent)
  onDocumentSymbolChangedEvent(e: DocumentSymbolChangedEvent) {
    this.notifyUpdate(e.payload);
  }

  @OnEvent(EditorSelectionChangeEvent)
  onEditorSelectionChangeEvent(e: EditorSelectionChangeEvent) {
    this.notifyUpdate(e.payload.editorUri);
  }

  private notifyUpdate(uri: URI) {
    if (!this.debouncedFireUriEvent.has(uri.toString())) {
      this.debouncedFireUriEvent.set(uri.toString(), debounce(() => {
        this._onDidUpdateBreadCrumb.fire(uri);
      }, 100, {maxWait: 1000}));
    }
    this.debouncedFireUriEvent.get(uri.toString())!();
  }
}

function sortByNumeric(files: FileStat[]): FileStat[] {
  return files.sort((a: FileStat, b: FileStat) => {
    if ((a.isDirectory && b.isDirectory) || (!a.isDirectory && !b.isDirectory)) {
      // numeric 参数确保数字为第一排序优先级
      const nameA = new URI(a.uri).path.name;
      const nameB = new URI(b.uri).path.name;
      return nameA.localeCompare(nameB, 'kn', { numeric: true });
    } else if (a.isDirectory && !b.isDirectory) {
      return -1;
    } else if (!a.isDirectory && b.isDirectory) {
      return 1;
    } else {
      return 0;
    }
  });
}

function positionInRange(pos: IPosition, range: IRange): boolean {
  if (pos.lineNumber < range.startLineNumber) {
    return false;
  } else if (pos.lineNumber === range.startLineNumber) {
    return pos.column >= range.startColumn;
  } else if (pos.lineNumber < range.endLineNumber) {
    return true;
  } else if (pos.lineNumber === range.endLineNumber) {
    return pos.column <= range.endColumn;
  } else {
    return false;
  }
}

function normalizeDocumentSymbols(documentSymbols: DocumentSymbol[], parent: INormalizedDocumentSymbol | IDummyRoot): INormalizedDocumentSymbol[] {
  documentSymbols.forEach((documentSymbol) => {
    (documentSymbol as INormalizedDocumentSymbol).parent = parent;
    if (documentSymbol.children && documentSymbol.children.length > 0) {
      normalizeDocumentSymbols(documentSymbol.children, documentSymbol);
    }
  });
  return documentSymbols;
}

export interface INormalizedDocumentSymbol extends DocumentSymbol {
  parent?: INormalizedDocumentSymbol | IDummyRoot;
  children?: INormalizedDocumentSymbol[];
}

export interface IDummyRoot {
  children?: INormalizedDocumentSymbol[];
}

function sortByRangeStart(rangeA: IRange, rangeB: IRange) {
  if (rangeA.startLineNumber > rangeB.startLineNumber) {
    return 1;
  } else if (rangeA.startLineNumber < rangeB.startLineNumber) {
    return -1;
  } else {
    if (rangeA.startColumn === rangeB.startColumn) {
      return 0;
    }
    return rangeA.startColumn > rangeB.startColumn ? 1 : -1;
  }
}
