-- SHARD 3: Owns users 3, 6 (user_id % 3 = 0)
-- This database only stores data for shard 3's users

CREATE TABLE IF NOT EXISTS users (
  id INT PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  shard_id INT NOT NULL
);

-- Shard 3 users
INSERT INTO users (id, name, shard_id) VALUES
(3, 'Charlie Brown', 3),
(6, 'Fiona Green', 3)
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

-- Seed data: Messages involving Shard 3 users (Charlie #3, Fiona #6)
DELETE FROM messages;

INSERT INTO messages (id, from_user_id, to_user_id, content, created_at, shard_id) VALUES
('550e8400-e29b-41d4-a716-446655440005', '1', '3', 'Charlie, did you see the match last night?', NOW() - INTERVAL '2 hours', '3'),
('550e8400-e29b-41d4-a716-446655440006', '3', '1', 'Yes! What an incredible game! Best match all season', NOW() - INTERVAL '1 hour 55 minutes', '3'),
('550e8400-e29b-41d4-a716-446655440011', '3', '6', 'Fiona, are you coming to the team lunch on Friday?', NOW() - INTERVAL '1 hour', '3'),
('550e8400-e29b-41d4-a716-446655440012', '6', '3', 'Definitely! Wouldn''t miss it 😊', NOW() - INTERVAL '50 minutes', '3')
ON CONFLICT DO NOTHING;
