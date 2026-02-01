-- SHARD 1: Owns users 1, 4 (user_id % 3 = 1)
-- This database only stores data for shard 1's users

CREATE TABLE IF NOT EXISTS users (
  id INT PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  shard_id INT NOT NULL
);

-- Shard 1 users
INSERT INTO users (id, name, shard_id) VALUES
(1, 'Alice Johnson', 1),
(4, 'Diana Prince', 1)
ON CONFLICT DO NOTHING;

CREATE TABLE IF NOT EXISTS messages (
  id UUID PRIMARY KEY,
  from_user_id VARCHAR(50) NOT NULL,
  to_user_id VARCHAR(50) NOT NULL,
  content TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
  shard_id VARCHAR(10)
);

-- Create indexes for better query performance
CREATE INDEX IF NOT EXISTS idx_messages_from_user ON messages(from_user_id);
CREATE INDEX IF NOT EXISTS idx_messages_to_user ON messages(to_user_id);
CREATE INDEX IF NOT EXISTS idx_messages_conversation ON messages(from_user_id, to_user_id);
CREATE INDEX IF NOT EXISTS idx_messages_shard ON messages(shard_id);
CREATE INDEX IF NOT EXISTS idx_messages_created_at ON messages(created_at DESC);

-- Seed data: Messages involving Shard 1 users (Alice #1, Diana #4)
DELETE FROM messages;

INSERT INTO messages (id, from_user_id, to_user_id, content, created_at, shard_id) VALUES
('550e8400-e29b-41d4-a716-446655440001', '1', '2', 'Hi Bob! How''s everything going?', NOW() - INTERVAL '2 hours', '1'),
('550e8400-e29b-41d4-a716-446655440002', '2', '1', 'Hey Alice! All good, just finished a project.', NOW() - INTERVAL '1 hour 50 minutes', '1'),
('550e8400-e29b-41d4-a716-446655440003', '1', '2', 'That''s awesome! Want to grab coffee later?', NOW() - INTERVAL '1 hour 40 minutes', '1'),
('550e8400-e29b-41d4-a716-446655440004', '2', '1', 'Sounds perfect! 3 PM at our usual spot?', NOW() - INTERVAL '1 hour 30 minutes', '1'),
('550e8400-e29b-41d4-a716-446655440007', '1', '4', 'Diana, the presentation is scheduled for tomorrow at 10 AM', NOW() - INTERVAL '3 hours', '1'),
('550e8400-e29b-41d4-a716-446655440008', '4', '1', 'Thanks for the reminder! I''m all set with the slides', NOW() - INTERVAL '2 hours 45 minutes', '1')
ON CONFLICT DO NOTHING;
