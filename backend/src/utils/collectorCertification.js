const hasValidHazardousCertification = (collector, now = new Date()) => {
  const certification = collector?.collector_profile?.hazardous_certification;
  return certification?.status === 'verified'
    && certification.expires_at
    && new Date(certification.expires_at) > now;
};

const isCollectorVerified = (collector, now = new Date()) => {
  const profile = collector?.collector_profile;
  return profile?.verification_status === 'verified'
    && (!profile.verification_expires_at || new Date(profile.verification_expires_at) > now);
};

module.exports = { hasValidHazardousCertification, isCollectorVerified };
