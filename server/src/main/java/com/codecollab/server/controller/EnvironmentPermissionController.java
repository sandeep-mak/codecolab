package com.codecollab.server.controller;

import com.codecollab.server.model.EnvironmentPermission;
import com.codecollab.server.model.User;
import com.codecollab.server.service.EnvironmentPermissionService;
import com.codecollab.server.repository.UserRepository;
import lombok.Data;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.core.userdetails.UserDetails;
import org.springframework.web.bind.annotation.*;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;

import java.util.List;
import java.util.UUID;

@CrossOrigin(origins = "*", maxAge = 3600)
@RestController
@RequestMapping("/api/environments/{environmentId}/permissions")
public class EnvironmentPermissionController {

    @Autowired
    private EnvironmentPermissionService permissionService;

    @Autowired
    private UserRepository userRepository;

    @Autowired
    private com.codecollab.server.service.AuditService auditService;

    @Autowired
    private com.codecollab.server.service.NotificationService notificationService;

    @Autowired
    private com.codecollab.server.repository.EnvironmentRepository environmentRepository;

    @GetMapping
    public ResponseEntity<List<EnvironmentPermission>> getPermissions(@PathVariable UUID environmentId) {
        return ResponseEntity.ok(permissionService.getPermissions(environmentId));
    }

    @PostMapping
    public ResponseEntity<?> grantPermission(@PathVariable UUID environmentId, @Valid @RequestBody GrantRequest request,
            @AuthenticationPrincipal UserDetails userDetails) {
        // Verify requestor is ADMIN (owner)
        User requestor = userRepository.findById(((com.codecollab.server.security.UserDetailsImpl) userDetails).getId())
                .orElseThrow(() -> new RuntimeException("User not found"));
        if (!permissionService.hasPermission(environmentId, requestor.getId(),
                EnvironmentPermission.AccessLevel.ADMIN)) {
            return ResponseEntity.status(403).body("Only Admins can grant permissions.");
        }

        try {
            EnvironmentPermission permission = permissionService.grantPermission(environmentId,
                    request.getUsernameOrEmail(), request.getAccessLevel());

            auditService.logAction(requestor.getId(), "PERMISSION_CHANGED", environmentId.toString(),
                    "Granted " + request.getAccessLevel() + " to " + request.getUsernameOrEmail());

            // Fire a real-time notification — look up user fresh from DB (not via detached
            // proxy)
            try {
                com.codecollab.server.model.User invitedUser = userRepository
                        .findByUsernameIgnoreCase(request.getUsernameOrEmail().trim())
                        .or(() -> userRepository.findByEmailIgnoreCase(request.getUsernameOrEmail().trim()))
                        .orElse(null);
                com.codecollab.server.model.Environment env = environmentRepository.findById(environmentId)
                        .orElse(null);
                if (invitedUser != null && env != null) {
                    notificationService.createAndSend(
                            invitedUser.getId(),
                            requestor.getUsername() + " added you to '" + env.getName() + "' as "
                                    + request.getAccessLevel(),
                            "/editor/" + environmentId);
                }
            } catch (Exception notifEx) {
                // Notification failure must never prevent the permission from being granted
                notifEx.printStackTrace();
            }

            return ResponseEntity.ok(permission);
        } catch (RuntimeException e) {
            return ResponseEntity.badRequest().body(e.getMessage());
        }

    }

    @DeleteMapping("/{userId}")
    public ResponseEntity<?> revokePermission(@PathVariable UUID environmentId, @PathVariable UUID userId,
            @AuthenticationPrincipal UserDetails userDetails) {
        // Verify requestor is ADMIN (owner)
        User requestor = userRepository.findById(((com.codecollab.server.security.UserDetailsImpl) userDetails).getId())
                .orElseThrow(() -> new RuntimeException("User not found"));
        if (!permissionService.hasPermission(environmentId, requestor.getId(),
                EnvironmentPermission.AccessLevel.ADMIN)) {
            return ResponseEntity.status(403).body("Only Admins can revoke permissions.");
        }

        permissionService.revokePermission(environmentId, userId);

        auditService.logAction(requestor.getId(), "PERMISSION_REVOKED", environmentId.toString(),
                "Revoked permission for user ID: " + userId);

        return ResponseEntity.ok("Permission revoked.");
    }

    @GetMapping("/me")
    public ResponseEntity<?> getMyPermission(@PathVariable UUID environmentId,
            @AuthenticationPrincipal UserDetails userDetails) {
        User user = userRepository.findById(((com.codecollab.server.security.UserDetailsImpl) userDetails).getId())
                .orElseThrow(() -> new RuntimeException("User not found"));
        EnvironmentPermission.AccessLevel level = permissionService.getUserAccessLevel(environmentId, user.getId());
        return ResponseEntity.ok(level);
    }

    @Data
    public static class GrantRequest {
        @NotBlank(message = "Username or Email cannot be empty")
        private String usernameOrEmail;

        @NotNull(message = "Access level must be provided")
        private EnvironmentPermission.AccessLevel accessLevel;
    }
}
