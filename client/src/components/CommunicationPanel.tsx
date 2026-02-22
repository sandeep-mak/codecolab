// @ts-nocheck
import React, { useState, useEffect, useRef } from 'react';
import SimplePeer from 'simple-peer';
import { Mic, MicOff, Send, Users, MessageSquare } from 'lucide-react';
// @ts-ignore
import * as process from 'process';
import { Buffer } from 'buffer';

// Polyfill for simple-peer in Vite
// @ts-ignore
if (typeof window !== 'undefined') {
    // @ts-ignore
    window.global = window;
    // @ts-ignore
    // Use a shallow copy to ensure the object is extensible
    const processPolyfill = { ...process };
    window.process = processPolyfill;
    // @ts-ignore
    window.Buffer = Buffer;

    // Explicitly polyfill nextTick if missing (critical for simple-peer/readable-stream)
    // @ts-ignore
    if (!window.process.nextTick) {
        // @ts-ignore
        window.process.nextTick = function (cb) {
            setTimeout(cb, 0);
        };
    }
}

interface CommunicationPanelProps {
    environmentId: string;
    user: any;
    token: string;
    isOpen: boolean;
    onClose: () => void;
}

interface PeerData {
    peerId: string;
    peer: SimplePeer.Instance;
    username: string;
}

interface VoiceUser {
    id: string;
    username: string;
}

interface ChatMessage {
    id: string;
    senderId: string;
    senderName: string;
    content: string;
    timestamp: string;
}

const CommunicationPanel: React.FC<CommunicationPanelProps> = ({ environmentId, user, token, isOpen, onClose }) => {
    const [activeTab, setActiveTab] = useState<'users' | 'chat'>('users');
    const [isVoiceActive, setIsVoiceActive] = useState(false);
    const [isMuted, setIsMuted] = useState(false);
    const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
    const [inputText, setInputText] = useState('');
    const [wsStatus, setWsStatus] = useState<'CONNECTING' | 'OPEN' | 'CLOSED'>('CONNECTING');
    const [connectedPeers, setConnectedPeers] = useState<VoiceUser[]>([]);

    // Refs
    const wsRef = useRef<WebSocket | null>(null);
    const peersRef = useRef<PeerData[]>([]);
    const streamRef = useRef<MediaStream | null>(null);
    const messagesEndRef = useRef<HTMLDivElement>(null);

    // Initialize WebSocket
    useEffect(() => {
        if (!isOpen) return;

        const wsUrl = `ws://localhost:8080/ws/signal/${environmentId}?token=${token}`;
        const ws = new WebSocket(wsUrl);

        ws.onopen = () => {
            console.log('Signal WS Connected');
            setWsStatus('OPEN');
        };

        ws.onmessage = (event) => {
            const message = JSON.parse(event.data);
            handleSignalMessage(message);
        };

        ws.onclose = () => {
            console.log('Signal WS Closed');
            setWsStatus('CLOSED');
            // Cleanup voice if connected
            if (isVoiceActive) leaveVoice();
        };

        ws.onerror = (err) => {
            console.error("Signal WS Error", err);
            setWsStatus('CLOSED');
        };

        wsRef.current = ws;

        return () => {
            ws.close();
            if (streamRef.current) {
                streamRef.current.getTracks().forEach(track => track.stop());
            }
        };
    }, [isOpen, environmentId, token]);

    // Scroll to bottom of chat
    useEffect(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [chatMessages, activeTab]);

    const handleSignalMessage = (message: any) => {
        switch (message.type) {
            case 'USER_JOINED':
                console.log('User joined:', message.userId);
                // Do NOT initiate connection here. Wait for JOIN_VOICE.
                break;
            case 'USER_LEFT':
                console.log('User left:', message.userId);
                removePeer(message.leaverId);
                break;
            case 'SIGNAL':
                // console.log('Received signal from:', message.senderId);
                const item = peersRef.current.find(p => p.peerId === message.senderId);
                if (item) {
                    item.peer.signal(message.data);
                } else {
                    // Incoming call - check streamRef to see if we are ready to receive
                    if (!streamRef.current) {
                        console.log("Ignored call because no local stream (voice inactive)");
                        return;
                    }
                    console.log("Accepting new call from:", message.senderId);
                    // Use a placeholder name until validated or updated
                    // Fix: Use senderName from message if available, else 'Unknown'
                    const senderName = message.senderName || 'Unknown';
                    const peer = addPeer(message.senderId, message.data, streamRef.current);
                    peersRef.current.push({ peerId: message.senderId, peer, username: senderName });
                    setConnectedPeers(prev => [...prev, { id: message.senderId, username: senderName }]);
                }
                break;
            case 'CHAT':
                setChatMessages(prev => [...prev, {
                    id: Date.now().toString(),
                    senderId: message.senderId,
                    senderName: message.senderName,
                    content: message.content,
                    timestamp: message.timestamp
                }]);
                break;
            case 'JOIN_VOICE':
                console.log('User joined voice:', message.senderId);
                if (streamRef.current) {
                    const existing = peersRef.current.find(p => p.peerId === message.senderId);
                    if (!existing) {
                        console.log("Initiating call to new voice user:", message.senderId);
                        const peer = createPeer(message.senderId, streamRef.current);
                        peersRef.current.push({ peerId: message.senderId, peer, username: message.senderName });
                        setConnectedPeers(prev => [...prev, { id: message.senderId, username: message.senderName }]);
                    } else {
                        // Update username if we already have the peer (e.g. from early SIGNAL)
                        if (existing.username !== message.senderName) {
                            existing.username = message.senderName;
                            setConnectedPeers(prev => prev.map(p => p.id === message.senderId ? { ...p, username: message.senderName } : p));
                        }
                    }
                }
                break;
            case 'LEAVE_VOICE':
                console.log('User left voice:', message.senderId);
                removePeer(message.senderId);
                break;
        }
    };

    const createPeer = (targetSessionId: string, stream: MediaStream) => {
        const peer = new SimplePeer({
            initiator: true,
            trickle: false,
            stream: stream
        });

        peer.on('signal', (data) => {
            console.log("Generated SIGNAL for target:", targetSessionId);
            wsRef.current?.send(JSON.stringify({
                type: 'SIGNAL',
                targetId: targetSessionId,
                senderName: user.username, // Send our name so target knows who called
                data: data
            }));
        });

        peer.on('stream', (remoteStream) => {
            console.log("Received remote stream from:", targetSessionId);
            // Create audio element
            const audio = document.createElement('audio');
            audio.srcObject = remoteStream;
            audio.play();
        });

        peer.on('error', (err) => console.error('Peer error (initiator):', err));

        peer.on('close', () => {
            console.log("Peer connection closed:", targetSessionId);
            removePeer(targetSessionId);
        });

        return peer;
    };

    const addPeer = (senderSessionId: string, incomingSignal: any, stream: MediaStream) => {
        const peer = new SimplePeer({
            initiator: false,
            trickle: false,
            stream: stream
        });

        peer.on('signal', (data) => {
            console.log("Generated ANSWER SIGNAL for target:", senderSessionId);
            wsRef.current?.send(JSON.stringify({
                type: 'SIGNAL',
                targetId: senderSessionId,
                senderName: user.username, // Send our name so target knows who answered
                data: data
            }));
        });

        peer.on('stream', (remoteStream) => {
            console.log("Received remote stream from (non-initiator):", senderSessionId);
            const audio = document.createElement('audio');
            audio.srcObject = remoteStream;
            audio.play();
        });

        peer.on('error', (err) => console.error('Peer error (receiver):', err));

        peer.on('close', () => {
            console.log("Peer connection closed:", senderSessionId);
            removePeer(senderSessionId);
        });

        peer.signal(incomingSignal);
        return peer;
    };

    const removePeer = (peerId: string) => {
        const item = peersRef.current.find(p => p.peerId === peerId);
        if (item) {
            item.peer.destroy();
            peersRef.current = peersRef.current.filter(p => p.peerId !== peerId);
            setConnectedPeers(prev => prev.filter(p => p.id !== peerId));
        }
    };

    const toggleMute = () => {
        if (streamRef.current) {
            const audioTrack = streamRef.current.getAudioTracks()[0];
            if (audioTrack) {
                audioTrack.enabled = !audioTrack.enabled;
                setIsMuted(!audioTrack.enabled);
            }
        }
    };

    const joinVoice = async () => {
        try {
            console.log("Requesting microphone access...");
            const stream = await navigator.mediaDevices.getUserMedia({ video: false, audio: true });
            console.log("Microphone access granted.");
            streamRef.current = stream;
            setIsVoiceActive(true);
            setIsMuted(false);

            if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
                console.log("Sending JOIN_VOICE message...");
                wsRef.current.send(JSON.stringify({
                    type: 'JOIN_VOICE',
                    senderId: user.username, // Using username as ID for display might collide if duplicates, but session ID is tracked in PeerData
                    senderName: user.username
                }));
            }

        } catch (err) {
            console.error("Failed to get local audio", err);
            alert("Could not access microphone.");
        }
    };

    const leaveVoice = () => {
        setIsVoiceActive(false);
        setIsMuted(false);
        if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
            console.log("Sending LEAVE_VOICE message...");
            wsRef.current.send(JSON.stringify({
                type: 'LEAVE_VOICE',
                senderId: user.username
            }));
        }

        if (streamRef.current) {
            streamRef.current.getTracks().forEach(track => track.stop());
            streamRef.current = null;
        }
        peersRef.current.forEach(p => p.peer.destroy());
        peersRef.current = [];
        setConnectedPeers([]);
    };

    const sendChatMessage = () => {
        if (!inputText.trim() || !wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;

        wsRef.current.send(JSON.stringify({
            type: 'CHAT',
            content: inputText,
            senderName: user.username
        }));
        setInputText('');
    };

    if (!isOpen) return null;

    return (
        <div className="w-80 bg-slate-900 border-l border-slate-800 flex flex-col h-full absolute right-0 top-14 bottom-0 z-20 shadow-xl">
            {/* Tabs */}
            <div className="flex border-b border-slate-800">
                <button
                    onClick={() => setActiveTab('users')}
                    className={`flex-1 py-3 text-sm font-medium flex items-center justify-center gap-2 ${activeTab === 'users' ? 'text-indigo-400 border-b-2 border-indigo-400' : 'text-slate-400 hover:text-slate-200'}`}
                >
                    <Users size={16} />
                    Voice
                </button>
                <button
                    onClick={() => setActiveTab('chat')}
                    className={`flex-1 py-3 text-sm font-medium flex items-center justify-center gap-2 ${activeTab === 'chat' ? 'text-indigo-400 border-b-2 border-indigo-400' : 'text-slate-400 hover:text-slate-200'}`}
                >
                    <MessageSquare size={16} />
                    Chat
                </button>
            </div>

            {/* Content */}
            <div className="flex-1 overflow-hidden flex flex-col">
                {activeTab === 'users' && (
                    <div className="p-4 flex flex-col items-center">
                        <div className="mb-6 text-center">
                            <div className={`w-16 h-16 rounded-full flex items-center justify-center mb-2 mx-auto transition-all ${isVoiceActive ? 'bg-green-500/20 text-green-400 ring-2 ring-green-500/50' : 'bg-slate-800 text-slate-500'}`}>
                                {isVoiceActive ? (isMuted ? <MicOff size={32} /> : <Mic size={32} />) : <MicOff size={32} />}
                            </div>
                            <h3 className="text-slate-200 font-medium">{isVoiceActive ? 'Voice Connected' : 'Voice Disconnected'}</h3>
                            <p className="text-xs text-slate-500 mt-1">{isVoiceActive ? (isMuted ? 'Muted' : 'Listening/Speaking...') : 'Join to speak with others'}</p>
                        </div>

                        <div className="flex gap-2 w-full">
                            <button
                                disabled={wsStatus !== 'OPEN'}
                                onClick={isVoiceActive ? leaveVoice : joinVoice}
                                className={`flex-1 py-2 px-4 rounded font-medium transition-colors ${wsStatus !== 'OPEN'
                                    ? 'bg-slate-700 text-slate-500 cursor-not-allowed'
                                    : isVoiceActive
                                        ? 'bg-red-500/10 text-red-400 hover:bg-red-500/20 border border-red-500/50'
                                        : 'bg-indigo-600 text-white hover:bg-indigo-500 shadow-lg shadow-indigo-500/20'
                                    }`}
                            >
                                {wsStatus !== 'OPEN' ? 'Connecting...' : (isVoiceActive ? 'Leave Voice' : 'Join Voice')}
                            </button>
                            {isVoiceActive && (
                                <button
                                    onClick={toggleMute}
                                    className={`p-2 rounded font-medium transition-colors border ${isMuted
                                        ? 'bg-red-500/10 text-red-400 border-red-500/50'
                                        : 'bg-slate-700 text-slate-300 border-slate-600 hover:bg-slate-600'
                                        }`}
                                    title={isMuted ? "Unmute" : "Mute"}
                                >
                                    {isMuted ? <MicOff size={20} /> : <Mic size={20} />}
                                </button>
                            )}
                        </div>

                        <div className="mt-8 w-full">
                            <h4 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3">Active Peers</h4>
                            <div className="space-y-2">
                                {isVoiceActive && connectedPeers.length === 0 && (
                                    <p className="text-sm text-slate-600 italic text-center">Waiting for others...</p>
                                )}
                                {!isVoiceActive && (
                                    <p className="text-sm text-slate-600 italic text-center">Join voice to see peers</p>
                                )}
                                {isVoiceActive && connectedPeers.map(peer => (
                                    <div key={peer.id} className="flex items-center gap-2 bg-slate-800/50 p-2 rounded">
                                        <div className="w-2 h-2 rounded-full bg-green-500"></div>
                                        <span className="text-sm text-slate-200">{peer.username}</span>
                                    </div>
                                ))}
                            </div>
                        </div>
                    </div>
                )}

                {activeTab === 'chat' && (
                    <>
                        <div className="flex-1 overflow-y-auto p-4 space-y-3">
                            {chatMessages.map((msg) => (
                                <div key={msg.id} className={`flex flex-col ${msg.senderName === user.username ? 'items-end' : 'items-start'}`}>
                                    <div className="flex items-baseline gap-2 mb-1">
                                        <span className="text-xs font-bold text-slate-300">{msg.senderName}</span>
                                        <span className="text-[10px] text-slate-600">{new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                                    </div>
                                    <div className={`px-3 py-2 rounded-lg text-sm max-w-[85%] break-words ${msg.senderName === user.username
                                        ? 'bg-indigo-600 text-white rounded-br-none'
                                        : 'bg-slate-800 text-slate-200 rounded-bl-none'
                                        }`}>
                                        {msg.content}
                                    </div>
                                </div>
                            ))}
                            <div ref={messagesEndRef} />
                        </div>
                        <div className="p-3 border-t border-slate-800 bg-slate-900">
                            <div className="flex gap-2">
                                <input
                                    type="text"
                                    value={inputText}
                                    onChange={(e) => setInputText(e.target.value)}
                                    onKeyDown={(e) => e.key === 'Enter' && sendChatMessage()}
                                    placeholder={wsStatus === 'OPEN' ? "Type a message..." : "Connecting..."}
                                    disabled={wsStatus !== 'OPEN'}
                                    className="flex-1 bg-slate-950 border border-slate-800 rounded-md px-3 py-2 text-sm text-white focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 transition-colors disabled:opacity-50"
                                />
                                <button
                                    onClick={sendChatMessage}
                                    disabled={wsStatus !== 'OPEN'}
                                    className={`bg-indigo-600 hover:bg-indigo-500 text-white p-2 rounded-md transition-colors ${wsStatus !== 'OPEN' ? 'opacity-50 cursor-not-allowed' : ''}`}
                                >
                                    <Send size={16} />
                                </button>
                            </div>
                        </div>
                    </>
                )}
            </div>
        </div>
    );
};
export default CommunicationPanel;
