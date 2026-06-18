const hasValidHazardousCertification = (collector, now = new Date()) => {
  const certification = collector?.collector_profile?.hazardous_certification;
  return certification?.status === 'verified'
    && certification.expires_at
    && new Date(certification.expires_at) > now;
};

module.exports = { hasValidHazardousCertification };
