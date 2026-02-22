package com.codecollab.server.handler;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.stereotype.Component;
import org.springframework.web.socket.CloseStatus;
import org.springframework.web.socket.TextMessage;
import org.springframework.web.socket.WebSocketSession;
import org.springframework.web.socket.handler.TextWebSocketHandler;

import java.io.IOException;
import java.net.URI;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.CopyOnWriteArraySet;

@Component
public class SignalingWebSocketHandler extends TextWebSocketHandler {

    // Map<EnvironmentId, Set<Session>>
    private final Map<String, Set<WebSocketSession>> rooms = new ConcurrentHashMap<>();

    // Map<SessionId, UserId>
    private final Map<String, UUID> sessionUserMap = new ConcurrentHashMap<>();

    // Map<SessionId, EnvironmentId>
    private final Map<String, String> sessionRoomMap = new ConcurrentHashMap<>();

    private final ObjectMapper objectMapper = new ObjectMapper();

    @Override
    public void afterConnectionEstablished(WebSocketSession session) throws Exception {
        // Extract Environment ID from URL
        String roomId = getRoomId(session);
        UUID userId = (UUID) session.getAttributes().get("userId");

        if (userId == null) {
            System.err.println("WS Signal: Unauthorized connection attempt.");
            session.close(CloseStatus.BAD_DATA);
            return;
        }

        rooms.computeIfAbsent(roomId, k -> new CopyOnWriteArraySet<>()).add(session);
        sessionUserMap.put(session.getId(), userId);
        sessionRoomMap.put(session.getId(), roomId);

        System.out.println("WS Signal: User " + userId + " joined room " + roomId);

        // Notify others in room that a new user joined (for mesh connection)
        broadcastToRoom(roomId, session, Map.of(
                "type", "USER_JOINED",
                "userId", userId.toString(),
                "initiatorId", session.getId() // Send session ID so clients know who to call
        ));
    }

    @Override
    public void afterConnectionClosed(WebSocketSession session, CloseStatus status) throws Exception {
        String roomId = sessionRoomMap.remove(session.getId());
        UUID userId = sessionUserMap.remove(session.getId());

        if (roomId != null) {
            Set<WebSocketSession> room = rooms.get(roomId);
            if (room != null) {
                room.remove(session);

                // Notify others that user left
                if (userId != null) {
                    broadcastToRoom(roomId, session, Map.of(
                            "type", "USER_LEFT",
                            "userId", userId.toString(),
                            "leaverId", session.getId()));
                }

                if (room.isEmpty()) {
                    rooms.remove(roomId);
                }
            }
        }
        System.out.println("WS Signal: Session " + session.getId() + " closed.");
    }

    @Override
    protected void handleTextMessage(WebSocketSession session, TextMessage message) throws Exception {
        Map<String, Object> payload;
        try {
            payload = objectMapper.readValue(message.getPayload(), Map.class);
        } catch (Exception e) {
            System.err.println("WS Signal: Failed to parse JSON: " + e.getMessage());
            return;
        }

        String type = (String) payload.get("type");
        String roomId = sessionRoomMap.get(session.getId());
        UUID userId = sessionUserMap.get(session.getId());

        if (roomId == null || userId == null)
            return;

        if ("CHAT".equals(type)) {
            // Broadcast text chat to everyone in room (including sender, for simple
            // confirmation)
            String content = (String) payload.get("content");
            Map<String, Object> chatMsg = Map.of(
                    "type", "CHAT",
                    "senderId", userId.toString(),
                    "senderName", payload.get("senderName"), // Frontend sends name
                    "content", content,
                    "timestamp", java.time.LocalDateTime.now().toString());
            broadcastToRoom(roomId, null, chatMsg); // null sender = broadcast to all
        } else if ("SIGNAL".equals(type)) {
            // Forward WebRTC signal to specific target
            String targetSessionId = (String) payload.get("targetId");
            if (targetSessionId != null) {
                WebSocketSession targetSession = findSessionById(roomId, targetSessionId);
                if (targetSession != null && targetSession.isOpen()) {
                    Map<String, Object> signalMsg = Map.of(
                            "type", "SIGNAL",
                            "senderId", session.getId(), // Send session ID so target knows who forwarded this
                            "senderName", payload.getOrDefault("senderName", "Unknown"),
                            "data", payload.get("data"));
                    sendMessage(targetSession, signalMsg);
                }
            }
        } else if ("JOIN_VOICE".equals(type)) {
            // Broadcast that a user joined voice
            Map<String, Object> joinMsg = Map.of(
                    "type", "JOIN_VOICE",
                    "senderId", session.getId(),
                    "userId", userId.toString(),
                    "senderName", payload.getOrDefault("senderName", "Unknown"));
            broadcastToRoom(roomId, session, joinMsg);
        } else if ("LEAVE_VOICE".equals(type)) {
            // Broadcast that a user left voice
            Map<String, Object> leaveMsg = Map.of(
                    "type", "LEAVE_VOICE",
                    "senderId", session.getId(),
                    "userId", userId.toString());
            broadcastToRoom(roomId, session, leaveMsg);
        }
    }

    private void broadcastToRoom(String roomId, WebSocketSession excludeSession, Map<String, Object> message) {
        Set<WebSocketSession> room = rooms.get(roomId);
        if (room != null) {
            String json;
            try {
                json = objectMapper.writeValueAsString(message);
            } catch (IOException e) {
                e.printStackTrace();
                return;
            }

            for (WebSocketSession s : room) {
                if (s.isOpen()) {
                    if (excludeSession == null || !s.getId().equals(excludeSession.getId())) {
                        try {
                            s.sendMessage(new TextMessage(json));
                        } catch (IOException e) {
                            e.printStackTrace();
                        }
                    }
                }
            }
        }
    }

    private void sendMessage(WebSocketSession session, Map<String, Object> message) {
        try {
            session.sendMessage(new TextMessage(objectMapper.writeValueAsString(message)));
        } catch (IOException e) {
            e.printStackTrace();
        }
    }

    private WebSocketSession findSessionById(String roomId, String sessionId) {
        Set<WebSocketSession> room = rooms.get(roomId);
        if (room != null) {
            for (WebSocketSession s : room) {
                if (s.getId().equals(sessionId)) {
                    return s;
                }
            }
        }
        return null;
    }

    private String getRoomId(WebSocketSession session) {
        // Expected URI: /ws/signal/{environmentId}
        URI uri = session.getUri();
        if (uri == null)
            return "default";

        String path = uri.getPath();
        String[] parts = path.split("/");
        // parts[0]="", parts[1]="ws", parts[2]="signal", parts[3]="envId"
        if (parts.length >= 4) {
            return parts[3];
        }
        return "default";
    }
}
