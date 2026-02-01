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

-- Insert some sample data for testing
INSERT INTO messages (id, from_user_id, to_user_id, content, created_at, shard_id) VALUES
('550e8400-e29b-41d4-a716-446655440001', '1', '2', 'Hey, how are you?', NOW(), '1'),
('550e8400-e29b-41d4-a716-446655440002', '2', '1', 'I am doing great!', NOW(), '1'),
('550e8400-e29b-41d4-a716-446655440003', '3', '4', 'Let''s meet tomorrow', NOW(), '2'),
('550e8400-e29b-41d4-a716-446655440004', '4', '3', 'Sounds good!', NOW(), '2'),
('550e8400-e29b-41d4-a716-446655440005', '5', '6', 'What''s up?', NOW(), '3'),
('550e8400-e29b-41d4-a716-446655440006', '6', '5', 'Not much, you?', NOW(), '3')
ON CONFLICT DO NOTHING;
