package com.codecollab.server.repository;

import com.codecollab.server.model.Environment;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

@Repository
public interface EnvironmentRepository extends JpaRepository<Environment, UUID> {
    List<Environment> findByOwnerId(UUID ownerId);

    Optional<Environment> findByJoinCode(String joinCode);

    List<Environment> findByGroupId(UUID groupId);
}
