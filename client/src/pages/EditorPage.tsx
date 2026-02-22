import { useState, useEffect, useRef } from 'react';

import { useParams, useNavigate } from 'react-router-dom';
import Editor, { type OnMount } from '@monaco-editor/react';
import axios from 'axios';
import * as Y from 'yjs';
import { HocuspocusProvider } from '@hocuspocus/provider';
import { MonacoBinding } from 'y-monaco';
import { useAuth } from '../context/AuthContext';
import CommunicationPanel from '../components/CommunicationPanel';
import ShareModal from '../components/ShareModal';
import Whiteboard from '../components/Whiteboard';
import AiAssistantPanel from '../components/AiAssistantPanel';
import { Save, Play, FileCode, Terminal, Share2, MessageCircle, Plus, PenTool, Bot } from 'lucide-react';
import { toast } from 'react-hot-toast';

interface File {
    id: string;
    name: string;
    content: string;
}

interface Environment {
    id: string;
    name: string;
    description: string;
    files: File[];
    whiteboardData?: string;
}

const EditorPage = () => {
    const { id } = useParams<{ id: string }>();
    const navigate = useNavigate();
    const { user, token } = useAuth();

    // State
    const [environment, setEnvironment] = useState<Environment | null>(null);
    const [files, setFiles] = useState<File[]>([]);
    const [activeFile, setActiveFile] = useState<File | null>(null);
    const [output, setOutput] = useState<string>('');
    const [isRunning, setIsRunning] = useState(false);
    const [isSaving, setIsSaving] = useState(false);
    const [permission, setPermission] = useState<string | null>(null);
    const [editorInstance, setEditorInstance] = useState<any>(null);

    // UI State
    const [isCommunicationOpen, setIsCommunicationOpen] = useState(false);
    const [isAiPanelOpen, setIsAiPanelOpen] = useState(false);
    const [isShareModalOpen, setIsShareModalOpen] = useState(false);
    const [viewMode, setViewMode] = useState<'code' | 'whiteboard'>('code');

    // Refs
    const editorRef = useRef<any>(null);
    const providerRef = useRef<any>(null); // Use 'any' type to avoid TS issues if HocuspocusProvider isn't perfectly identical to WebsocketProvider
    const docRef = useRef<Y.Doc | null>(null);
    const bindingRef = useRef<MonacoBinding | null>(null);

    // Computed
    const isReadOnly = permission === 'VIEWER';
    const isAdmin = permission === 'ADMIN';
    const canRun = permission === 'ADMIN' || permission === 'EDITOR';

    // Fetch Environment & Permissions
    useEffect(() => {
        if (!id || !token) return;

        const fetchData = async () => {
            try {
                // Fetch Permissions first
                try {
                    const permRes = await axios.get(`${API_BASE_URL}/api/environments/${id}/permissions/me`, {
                        headers: { Authorization: `Bearer ${token}` }
                    });
                    setPermission(permRes.data);
                } catch (err) {
                    console.warn("Failed to fetch permissions, defaulting to viewer", err);
                    setPermission('VIEWER');
                }

                // Fetch Environment
                const envRes = await axios.get(`${API_BASE_URL}/api/environments/${id}`, {
                    headers: { Authorization: `Bearer ${token}` }
                });
                setEnvironment(envRes.data);
                if (envRes.data.files && envRes.data.files.length > 0) {
                    setFiles(envRes.data.files);
                    setActiveFile(envRes.data.files[0]);
                }
            } catch (error: any) {
                console.error("Failed to load environment:", error);
                if (error.response?.status === 404) {
                    toast.error("Environment not found or deleted");
                } else {
                    toast.error("Failed to load environment");
                }
                navigate('/dashboard');
            }
        };

        fetchData();
    }, [id, token]);

    // 1. Setup Yjs Doc and Provider independently of the editor
    useEffect(() => {
        if (!id || !token) return;

        // Initialize Doc & Provider if not exists
        if (!docRef.current) {
            docRef.current = new Y.Doc();
            providerRef.current = new HocuspocusProvider({
                url: 'ws://127.0.0.1:1234',
                name: id,
                document: docRef.current,
                token: token
            });

            // Log status
            providerRef.current.on('status', (event: any) => {
                console.log('Yjs Status:', event.status);
            });

            // Dynamically inject CSS for cursors since y-monaco only manages class names
            providerRef.current.awareness.on('change', () => {
                const states = providerRef.current.awareness.getStates();
                let css = '';
                states.forEach((state: any, clientId: number) => {
                    if (state.user && state.user.color) {
                        const color = state.user.color;
                        const name = state.user.name || 'Anonymous';
                        css += `
                            .yRemoteSelection-${clientId} {
                                background-color: ${color}33 !important;
                            }
                            .yRemoteSelectionHead-${clientId}::after {
                                position: absolute;
                                content: '${name}';
                                background-color: ${color};
                                color: white;
                                font-size: 11px;
                                font-weight: bold;
                                font-family: sans-serif;
                                padding: 2px 4px;
                                border-radius: 4px;
                                border-top-left-radius: 0;
                                top: 100%;
                                left: 0;
                                white-space: nowrap;
                                z-index: 1000;
                                pointer-events: none;
                            }
                            .yRemoteSelectionHead-${clientId} {
                                position: relative;
                                border-left: 2px solid ${color} !important;
                                margin-left: -2px;
                                display: inline-block;
                                box-sizing: border-box;
                            }
                        `;
                    }
                });

                let styleNode = document.getElementById('yjs-cursors-style');
                if (!styleNode) {
                    styleNode = document.createElement('style');
                    styleNode.id = 'yjs-cursors-style';
                    document.head.appendChild(styleNode);
                }
                styleNode.innerHTML = css;
            });
        }

        if (docRef.current && environment?.whiteboardData) {
            const doc = docRef.current;
            // Load Whiteboard if empty
            const yLines = doc.getArray('whiteboard-paths');
            if (yLines.length === 0) {
                try {
                    const parsed = JSON.parse(environment.whiteboardData);
                    if (Array.isArray(parsed) && parsed.length > 0) {
                        // Avoid duplicates if another client is also pushing
                        if (yLines.length === 0) {
                            yLines.push(parsed);
                        }
                    }
                } catch (e) {
                    console.error("Failed to parse whiteboard data", e);
                }
            }
        }

        return () => {
            // We intentionally keep doc and provider alive for the session
            // They will be cleaned up when the component unmounts entirely (user leaves page).
        };
    }, [id, token, environment]);

    // 1b. Update Awareness User State whenever user object loads
    useEffect(() => {
        if (!providerRef.current || !user || !user.username) return;

        const awareness = providerRef.current.awareness;
        // Only inject color if we don't already have one to prevent flicker
        const existingState = awareness.getLocalState();
        const color = existingState?.color || '#' + Math.floor(Math.random() * 16777215).toString(16);

        awareness.setLocalStateField('user', {
            name: user.username,
            color: color,
            colorLight: color + '33'
        });
        awareness.setLocalStateField('name', user.username);
        awareness.setLocalStateField('color', color);
    }, [user?.username]);


    // 2. Bind Monaco Editor to Yjs
    useEffect(() => {
        if (viewMode !== 'code') return;
        if (!id || !activeFile || !editorInstance || !docRef.current || !providerRef.current) return;

        const model = editorInstance.getModel();
        if (!model) return;

        // Cleanup previous binding
        if (bindingRef.current) {
            bindingRef.current.destroy();
            bindingRef.current = null;
        }

        const doc = docRef.current;
        const provider = providerRef.current;
        const yText = doc.getText(activeFile.id); // Use file ID as distinct text model

        // Initialize Yjs text with file content if it's empty
        if (yText.length === 0 && activeFile.content) {
            yText.insert(0, activeFile.content);
        }

        // Bind to Editor
        bindingRef.current = new MonacoBinding(
            yText,
            model,
            new Set([editorInstance]),
            provider.awareness
        );

        return () => {
            if (bindingRef.current) {
                bindingRef.current.destroy();
                bindingRef.current = null;
            }
        };
    }, [id, activeFile, viewMode, editorInstance]);

    // Handle Editor Mount
    const handleEditorDidMount: OnMount = (editor, _monaco) => {
        editorRef.current = editor;
        setEditorInstance(editor);
    };

    // Run Code
    const handleRun = async () => {
        if (!activeFile || !id) return;
        setIsRunning(true);
        setOutput('Running...');

        try {
            // Get current content from editor
            const code = editorRef.current?.getValue() || activeFile.content;

            const response = await axios.post(`${API_BASE_URL}/api/execute`, {
                code,
                environmentId: id
            }, {
                headers: { Authorization: `Bearer ${token}` }
            });
            setOutput(response.data);
        } catch (error: any) {
            console.error("Execution failed:", error);
            setOutput(error.response?.data || "Execution failed");
        } finally {
            setIsRunning(false);
        }
    };

    // Save File & Whiteboard
    const handleSave = async () => {
        setIsSaving(true);
        try {
            if (activeFile) {
                const content = editorRef.current?.getValue() || "";
                await axios.put(`${API_BASE_URL}/api/files/${activeFile.id}`, {
                    content
                }, {
                    headers: { Authorization: `Bearer ${token}` }
                });
                // Update local file state
                setFiles(files.map(f => f.id === activeFile.id ? { ...f, content } : f));
            }

            // Save whiteboard data
            if (docRef.current) {
                const yLines = docRef.current.getArray('whiteboard-paths');
                const data = JSON.stringify(yLines.toArray());
                await axios.put(`${API_BASE_URL}/api/environments/${id}/whiteboard`, {
                    data
                }, {
                    headers: { Authorization: `Bearer ${token}` }
                });
            }
            toast.success("Saved successfully");
        } catch (error) {
            console.error("Save failed:", error);
            toast.error("Failed to save changes");
        } finally {
            setIsSaving(false);
        }
    };

    return (
        <div className="flex h-screen bg-slate-950 text-white overflow-hidden relative">
            {/* Sidebar (File Explorer) */}
            <div className="w-64 bg-slate-900 border-r border-slate-800 flex flex-col">
                <div className="p-4 border-b border-slate-800 flex items-center justify-between">
                    <span className="font-semibold text-slate-200">Explorer</span>
                    <button className="text-slate-400 hover:text-white"><Plus size={16} /></button>
                </div>
                <div className="flex-1 overflow-y-auto p-2">
                    {files.map(file => (
                        <div
                            key={file.id}
                            onClick={() => setActiveFile(file)}
                            className={`flex items-center gap-2 px-3 py-2 rounded cursor-pointer transition-colors ${activeFile?.id === file.id ? 'bg-slate-800 text-indigo-400' : 'text-slate-400 hover:bg-slate-800 hover:text-slate-200'
                                }`}
                        >
                            <FileCode size={16} />
                            <span className="text-sm truncate">{file.name}</span>
                        </div>
                    ))}
                </div>
            </div>

            {/* Main Content */}
            <div className="flex-1 flex flex-col relative z-10 transition-all duration-300" style={{ marginRight: isCommunicationOpen || isAiPanelOpen ? '320px' : '0' }}>
                {/* Header / Toolbar */}
                <div className="h-14 bg-slate-900 border-b border-slate-800 flex items-center justify-between px-4">
                    <div className="text-sm font-medium text-slate-300 flex items-center gap-2">
                        <span className="text-slate-500">{environment?.name || 'Loading...'}</span>
                        <span className="text-slate-600">/</span>
                        <span className="text-slate-200">{activeFile?.name || 'No file selected'}</span>
                        {permission && (
                            <span className="ml-4 text-xs bg-slate-800 px-2 py-1 rounded text-slate-400 border border-slate-700">
                                {permission}
                            </span>
                        )}
                    </div>

                    <div className="flex items-center gap-2">
                        <div className="flex bg-slate-800 p-0.5 rounded-lg border border-slate-700 mr-4">
                            <button
                                onClick={() => setViewMode('code')}
                                className={`px-3 py-1 text-sm rounded-md transition-colors flex items-center gap-1.5 ${viewMode === 'code' ? 'bg-slate-700 font-medium text-white shadow-sm' : 'text-slate-400 hover:text-slate-200 hover:bg-slate-700/50'}`}
                            >
                                <FileCode size={14} />
                                Code
                            </button>
                            <button
                                onClick={() => setViewMode('whiteboard')}
                                className={`px-3 py-1 text-sm rounded-md transition-colors flex items-center gap-1.5 ${viewMode === 'whiteboard' ? 'bg-slate-700 font-medium text-white shadow-sm' : 'text-slate-400 hover:text-slate-200 hover:bg-slate-700/50'}`}
                            >
                                <PenTool size={14} />
                                Whiteboard
                            </button>
                        </div>
                        <button
                            onClick={() => { setIsCommunicationOpen(!isCommunicationOpen); setIsAiPanelOpen(false); }}
                            className={`px-3 py-1.5 rounded flex items-center gap-2 text-sm transition-colors border border-slate-700 mr-2 ${isCommunicationOpen ? 'bg-indigo-600 text-white border-indigo-500' : 'bg-slate-800 hover:bg-slate-700 text-white'}`}
                        >
                            <MessageCircle size={16} />
                            Chat & Voice
                        </button>

                        <button
                            onClick={() => { setIsAiPanelOpen(!isAiPanelOpen); setIsCommunicationOpen(false); }}
                            className={`px-3 py-1.5 rounded flex items-center gap-2 text-sm transition-colors border border-slate-700 mr-2 ${isAiPanelOpen ? 'bg-indigo-600 text-white border-indigo-500' : 'bg-slate-800 hover:bg-slate-700 text-white'}`}
                        >
                            <Bot size={16} />
                            Ask AI
                        </button>

                        {isAdmin && (
                            <button
                                onClick={() => setIsShareModalOpen(true)}
                                className="bg-slate-800 hover:bg-slate-700 text-white px-3 py-1.5 rounded flex items-center gap-2 text-sm transition-colors border border-slate-700 mr-2"
                            >
                                <Share2 size={16} />
                                Share
                            </button>
                        )}

                        <button
                            onClick={handleSave}
                            disabled={isSaving || isReadOnly}
                            className={`bg-slate-800 hover:bg-slate-700 text-white px-3 py-1.5 rounded flex items-center gap-2 text-sm transition-colors border border-slate-700 ${isReadOnly ? 'opacity-50 cursor-not-allowed' : ''}`}
                        >
                            <Save size={16} />
                            {isSaving ? 'Saving...' : 'Save'}
                        </button>
                        <button
                            onClick={handleRun}
                            disabled={isRunning || !canRun}
                            className={`bg-indigo-600 hover:bg-indigo-500 text-white px-3 py-1.5 rounded flex items-center gap-2 text-sm transition-colors shadow-lg shadow-indigo-500/20 ${(!canRun) ? 'opacity-50 cursor-not-allowed' : ''}`}
                        >
                            <Play size={16} />
                            {isRunning ? 'Running...' : 'Run'}
                        </button>
                    </div>
                </div>

                {/* Editor Area */}
                <div className="flex-1 relative bg-slate-950 flex">
                    {viewMode === 'code' ? (
                        <Editor
                            height="100%"
                            defaultLanguage="python"
                            theme="vs-dark"
                            defaultValue="// Loading..."
                            value={activeFile?.content} // Only for initial load, Yjs takes over
                            onMount={handleEditorDidMount}
                            options={{
                                minimap: { enabled: false },
                                fontSize: 14,
                                padding: { top: 16 },
                                readOnly: isReadOnly,
                                automaticLayout: true,
                            }}
                        />
                    ) : (
                        <Whiteboard doc={docRef.current} isReadOnly={isReadOnly} />
                    )}
                </div>

                {/* Terminal / Output */}
                <div className="h-48 bg-slate-950 border-t border-slate-800 flex flex-col">
                    <div className="bg-slate-900 px-4 py-1.5 text-xs text-slate-400 flex items-center gap-2 select-none border-b border-slate-800">
                        <Terminal size={12} />
                        TERMINAL
                    </div>
                    <div className="flex-1 p-4 font-mono text-sm overflow-auto text-emerald-400 whitespace-pre-wrap bg-slate-950">
                        {output || "Ready to execute..."}
                    </div>
                </div>
            </div>

            {id && <ShareModal
                environmentId={id}
                isOpen={isShareModalOpen}
                onClose={() => setIsShareModalOpen(false)}
            />}

            {id && user && token && (
                <CommunicationPanel
                    environmentId={id}
                    user={user}
                    token={token}
                    isOpen={isCommunicationOpen}
                    onClose={() => setIsCommunicationOpen(false)}
                />
            )}

            {id && token && (
                <AiAssistantPanel
                    isOpen={isAiPanelOpen}
                    onClose={() => setIsAiPanelOpen(false)}
                    editorInstance={editorInstance}
                    token={token}
                />
            )}
        </div>
    );
};

export default EditorPage;
