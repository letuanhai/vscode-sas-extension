// Copyright © 2022-2024, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0
/* eslint-disable @typescript-eslint/no-unused-vars */
import {
  CallHierarchyIncomingCall,
  CallHierarchyIncomingCallsParams,
  CallHierarchyItem,
  CallHierarchyOutgoingCall,
  CallHierarchyOutgoingCallsParams,
  CallHierarchyPrepareParams,
  CancellationToken,
  CodeAction,
  CodeActionParams,
  Command,
  CompletionItem,
  CompletionList,
  CompletionParams,
  Connection,
  Declaration,
  DeclarationLink,
  Definition,
  DefinitionLink,
  DidChangeConfigurationParams,
  DidChangeWatchedFilesParams,
  DidCloseTextDocumentParams,
  DidOpenTextDocumentParams,
  DocumentHighlight,
  DocumentHighlightParams,
  DocumentSymbol,
  DocumentSymbolParams,
  ExecuteCommandParams,
  Hover,
  HoverParams,
  InitializeParams,
  InitializeResult,
  LSPAny,
  Location,
  PrepareRenameParams,
  Range,
  ReferenceParams,
  RenameParams,
  ResultProgressReporter,
  SignatureHelp,
  SignatureHelpParams,
  SymbolInformation,
  TextDocumentPositionParams,
  WorkDoneProgressReporter,
  WorkspaceEdit,
  WorkspaceSymbol,
  WorkspaceSymbolParams,
} from "vscode-languageserver";
import { TextDocument } from "vscode-languageserver-textdocument";

import { LanguageServiceProvider } from "../../sas/LanguageServiceProvider";

export class PyrightLanguageProviderNode {
  constructor(
    _connection: Connection,
    _maxWorkers: number,
  ) {}

  public setSasLspProvider(
    _provider: (uri: string) => LanguageServiceProvider,
  ): void {}

  public getClientCapabilities(): {
    hasVisualStudioExtensionsCapability: boolean;
  } {
    return { hasVisualStudioExtensionsCapability: false };
  }

  public async initialize(
    _params: InitializeParams,
    _supportedCommands: string[],
    _supportedCodeActions: string[],
  ): Promise<InitializeResult> {
    return { capabilities: {} };
  }

  public onInitialized(): void {}

  public addContentChange(_doc: TextDocument): void {}

  public async onHover(
    _params: HoverParams,
    _token: CancellationToken,
  ): Promise<Hover | null | undefined> {
    return null;
  }

  public async onCompletion(
    _params: CompletionParams,
    _token: CancellationToken,
  ): Promise<CompletionList | null> {
    return null;
  }

  public async onCompletionResolve(
    params: CompletionItem,
    _token: CancellationToken,
  ): Promise<CompletionItem> {
    return params;
  }

  public async onDocumentSymbol(
    _params: DocumentSymbolParams,
    _token: CancellationToken,
  ): Promise<DocumentSymbol[] | SymbolInformation[] | null | undefined> {
    return null;
  }

  public async onWorkspaceSymbol(
    _params: WorkspaceSymbolParams,
    _token: CancellationToken,
    _resultReporter?: ResultProgressReporter<SymbolInformation[]>,
  ): Promise<SymbolInformation[] | WorkspaceSymbol[] | null | undefined> {
    return null;
  }

  public async onDocumentHighlight(
    _params: DocumentHighlightParams,
    _token: CancellationToken,
  ): Promise<DocumentHighlight[] | null | undefined> {
    return null;
  }

  public async onSignatureHelp(
    _params: SignatureHelpParams,
    _token: CancellationToken,
  ): Promise<SignatureHelp | null | undefined> {
    return null;
  }

  public async onDefinition(
    _params: TextDocumentPositionParams,
    _token: CancellationToken,
  ): Promise<Definition | DefinitionLink[] | undefined | null> {
    return undefined;
  }

  public async onDeclaration(
    _params: TextDocumentPositionParams,
    _token: CancellationToken,
  ): Promise<Declaration | DeclarationLink[] | undefined | null> {
    return undefined;
  }

  public async onTypeDefinition(
    _params: TextDocumentPositionParams,
    _token: CancellationToken,
  ): Promise<Definition | DefinitionLink[] | undefined | null> {
    return undefined;
  }

  public async onReferences(
    _params: ReferenceParams,
    _token: CancellationToken,
    _workDoneReporter: WorkDoneProgressReporter,
    _resultReporter: ResultProgressReporter<Location[]> | undefined,
    ...rest: unknown[]
  ): Promise<Location[] | null | undefined> {
    return undefined;
  }

  public async onPrepareRenameRequest(
    _params: PrepareRenameParams,
    _token: CancellationToken,
  ): Promise<Range | { range: Range; placeholder: string } | null | undefined> {
    return null;
  }

  public async onRenameRequest(
    _params: RenameParams,
    _token: CancellationToken,
  ): Promise<WorkspaceEdit | null | undefined> {
    return null;
  }

  public async onCallHierarchyPrepare(
    _params: CallHierarchyPrepareParams,
    _token: CancellationToken,
  ): Promise<CallHierarchyItem[] | null> {
    return null;
  }

  public async onCallHierarchyIncomingCalls(
    _params: CallHierarchyIncomingCallsParams,
    _token: CancellationToken,
  ): Promise<CallHierarchyIncomingCall[] | null> {
    return null;
  }

  public async onCallHierarchyOutgoingCalls(
    _params: CallHierarchyOutgoingCallsParams,
    _token: CancellationToken,
  ): Promise<CallHierarchyOutgoingCall[] | null> {
    return null;
  }

  public onDidChangeWatchedFiles(_params: DidChangeWatchedFilesParams): void {}

  public async onExecuteCommand(
    _params: ExecuteCommandParams,
    _token: CancellationToken,
    _reporter: WorkDoneProgressReporter,
  ): Promise<LSPAny | undefined> {
    return undefined;
  }

  public async onShutdown(_token: CancellationToken): Promise<void> {}

  public async executeCodeAction(
    _params: CodeActionParams,
    _token: CancellationToken,
  ): Promise<(Command | CodeAction)[] | undefined | null> {
    return undefined;
  }

  public async onDidOpenTextDocument(
    _params: DidOpenTextDocumentParams,
  ): Promise<void> {}

  public async onDidCloseTextDocument(
    _params: DidCloseTextDocumentParams,
  ): Promise<void> {}

  public onDidChangeConfiguration(
    _params: DidChangeConfigurationParams,
  ): void {}
}
