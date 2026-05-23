#!/bin/bash
set -e

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<-EOSQL
    CREATE DATABASE warden_client_acme;
    CREATE DATABASE warden_client_globex;
    CREATE DATABASE warden_central;
EOSQL

# Now create schemas for warden_client_acme
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "warden_client_acme" <<-EOSQL
    CREATE TABLE employees (
        id SERIAL PRIMARY KEY,
        email VARCHAR(255) UNIQUE NOT NULL,
        password_hash VARCHAR(255) NOT NULL,
        is_locked BOOLEAN DEFAULT FALSE,
        lock_until TIMESTAMP WITH TIME ZONE NULL,
        failed_attempts INTEGER DEFAULT 0,
        last_login TIMESTAMP WITH TIME ZONE NULL,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    );
    CREATE TABLE sessions (
        id UUID PRIMARY KEY,
        employee_id INTEGER REFERENCES employees(id) ON DELETE CASCADE,
        token_hash VARCHAR(255) UNIQUE NOT NULL,
        device_fingerprint TEXT NOT NULL,
        ip_address VARCHAR(45) NOT NULL,
        status VARCHAR(20) DEFAULT 'active',
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
        refresh_token_hash VARCHAR(255) NULL,
        refresh_expires_at TIMESTAMP WITH TIME ZONE NULL
    );
    CREATE TABLE login_attempts (
        id SERIAL PRIMARY KEY,
        email VARCHAR(255) NOT NULL,
        ip_address VARCHAR(45) NOT NULL,
        device_fingerprint TEXT NOT NULL,
        success BOOLEAN NOT NULL,
        reason VARCHAR(255) NOT NULL,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    );
    CREATE TABLE otp_challenges (
        id SERIAL PRIMARY KEY,
        session_id UUID REFERENCES sessions(id) ON DELETE CASCADE,
        otp_code VARCHAR(6) NOT NULL,
        expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
        attempts INTEGER DEFAULT 0,
        verified BOOLEAN DEFAULT FALSE
    );
EOSQL

# Now create schemas for warden_client_globex
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "warden_client_globex" <<-EOSQL
    CREATE TABLE employees (
        id SERIAL PRIMARY KEY,
        email VARCHAR(255) UNIQUE NOT NULL,
        password_hash VARCHAR(255) NOT NULL,
        is_locked BOOLEAN DEFAULT FALSE,
        lock_until TIMESTAMP WITH TIME ZONE NULL,
        failed_attempts INTEGER DEFAULT 0,
        last_login TIMESTAMP WITH TIME ZONE NULL,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    );
    CREATE TABLE sessions (
        id UUID PRIMARY KEY,
        employee_id INTEGER REFERENCES employees(id) ON DELETE CASCADE,
        token_hash VARCHAR(255) UNIQUE NOT NULL,
        device_fingerprint TEXT NOT NULL,
        ip_address VARCHAR(45) NOT NULL,
        status VARCHAR(20) DEFAULT 'active',
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
        refresh_token_hash VARCHAR(255) NULL,
        refresh_expires_at TIMESTAMP WITH TIME ZONE NULL
    );
    CREATE TABLE login_attempts (
        id SERIAL PRIMARY KEY,
        email VARCHAR(255) NOT NULL,
        ip_address VARCHAR(45) NOT NULL,
        device_fingerprint TEXT NOT NULL,
        success BOOLEAN NOT NULL,
        reason VARCHAR(255) NOT NULL,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    );
    CREATE TABLE otp_challenges (
        id SERIAL PRIMARY KEY,
        session_id UUID REFERENCES sessions(id) ON DELETE CASCADE,
        otp_code VARCHAR(6) NOT NULL,
        expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
        attempts INTEGER DEFAULT 0,
        verified BOOLEAN DEFAULT FALSE
    );
EOSQL

# Now create schemas for warden_central
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "warden_central" <<-EOSQL
    CREATE TABLE companies (
        id VARCHAR(50) PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        domain VARCHAR(255) UNIQUE NOT NULL,
        api_key_hash VARCHAR(255) UNIQUE NOT NULL,
        callback_url VARCHAR(255) NOT NULL,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    );
    CREATE TABLE company_admins (
        id SERIAL PRIMARY KEY,
        company_id VARCHAR(50) REFERENCES companies(id) ON DELETE SET NULL,
        email VARCHAR(255) UNIQUE NOT NULL,
        password_hash VARCHAR(255) NOT NULL,
        role VARCHAR(20) NOT NULL,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    );
    CREATE TABLE employees (
        id SERIAL PRIMARY KEY,
        company_id VARCHAR(50) REFERENCES companies(id) ON DELETE CASCADE,
        external_employee_id INTEGER NOT NULL,
        email VARCHAR(255) NOT NULL,
        registered_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    );
    CREATE UNIQUE INDEX idx_employees_company_ext ON employees(company_id, external_employee_id);

    CREATE TABLE login_events (
        id SERIAL PRIMARY KEY,
        company_id VARCHAR(50) REFERENCES companies(id) ON DELETE CASCADE,
        employee_id INTEGER NULL,
        email VARCHAR(255) NOT NULL,
        event_type VARCHAR(30) NOT NULL,
        ip_address VARCHAR(45) NOT NULL,
        city VARCHAR(100) NULL,
        country VARCHAR(100) NULL,
        latitude DECIMAL(9,6) NULL,
        longitude DECIMAL(9,6) NULL,
        device_fingerprint JSONB NOT NULL,
        risk_score INTEGER NOT NULL,
        timestamp TIMESTAMP WITH TIME ZONE NOT NULL
    );
    CREATE INDEX idx_login_events_rolling ON login_events(company_id, employee_id, timestamp);

    CREATE TABLE risk_scores (
        id SERIAL PRIMARY KEY,
        login_event_id INTEGER REFERENCES login_events(id) ON DELETE CASCADE,
        total_score INTEGER NOT NULL,
        action_taken VARCHAR(30) NOT NULL,
        score_breakdown_json JSONB NOT NULL
    );
    CREATE TABLE device_history (
        id SERIAL PRIMARY KEY,
        company_id VARCHAR(50) REFERENCES companies(id) ON DELETE CASCADE,
        employee_id INTEGER NOT NULL,
        fingerprint_hash VARCHAR(64) NOT NULL,
        first_seen TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        last_seen TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    );
    CREATE TABLE behavior_baselines (
        id SERIAL PRIMARY KEY,
        company_id VARCHAR(50) REFERENCES companies(id) ON DELETE CASCADE,
        employee_id INTEGER NOT NULL,
        avg_login_hour_start INTEGER DEFAULT 8,
        avg_login_hour_end INTEGER DEFAULT 18,
        common_ips JSONB DEFAULT '[]'::jsonb,
        common_countries JSONB DEFAULT '[]'::jsonb,
        last_successful_login_lat DECIMAL(9,6) NULL,
        last_successful_login_lng DECIMAL(9,6) NULL,
        last_successful_login_time TIMESTAMP WITH TIME ZONE NULL,
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    );
    CREATE TABLE active_employee_sessions (
        id SERIAL PRIMARY KEY,
        company_id VARCHAR(50) REFERENCES companies(id) ON DELETE CASCADE,
        employee_id INTEGER NOT NULL,
        client_session_id UUID NOT NULL,
        ip_address VARCHAR(45) NOT NULL,
        device_fingerprint_hash VARCHAR(64) NOT NULL,
        started_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        last_active TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        is_active BOOLEAN DEFAULT TRUE
    );
    CREATE TABLE admin_sessions (
        id SERIAL PRIMARY KEY,
        company_id VARCHAR(50) NULL,
        admin_id INTEGER REFERENCES company_admins(id) ON DELETE CASCADE,
        token_hash VARCHAR(255) UNIQUE NOT NULL,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        expires_at TIMESTAMP WITH TIME ZONE NOT NULL
    );
    CREATE TABLE alerts (
        id SERIAL PRIMARY KEY,
        company_id VARCHAR(50) REFERENCES companies(id) ON DELETE CASCADE,
        employee_id INTEGER NULL,
        severity VARCHAR(20) NOT NULL,
        reason VARCHAR(255) NOT NULL,
        status VARCHAR(20) DEFAULT 'active',
        acknowledged_by INTEGER REFERENCES company_admins(id) ON DELETE SET NULL,
        acknowledged_at TIMESTAMP WITH TIME ZONE NULL,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    );
    CREATE TABLE audit_logs (
        id SERIAL PRIMARY KEY,
        company_id VARCHAR(50) NULL,
        admin_id INTEGER REFERENCES company_admins(id) ON DELETE SET NULL,
        action VARCHAR(100) NOT NULL,
        target_type VARCHAR(50) NOT NULL,
        target_id VARCHAR(50) NOT NULL,
        metadata_json JSONB NULL,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    );

    CREATE RULE no_update_audit AS ON UPDATE TO audit_logs DO INSTEAD NOTHING;
    CREATE RULE no_delete_audit AS ON DELETE TO audit_logs DO INSTEAD NOTHING;
EOSQL
