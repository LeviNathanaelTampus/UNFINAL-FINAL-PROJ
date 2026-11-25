'use strict';
/** Shapes that are safe to send to other users. */

function publicUserRef(u) {
  if (!u) return null;
  if (!u.fullName) return { _id: u._id || u }; // unpopulated
  const verified = u.verification?.status === 'verified';
  return {
    _id: u._id,
    fullName: u.fullName,
    avatar: u.avatar || null,
    verified,
    professionalType: verified ? u.verification.type : null,
    profession: verified ? u.verification.profession : null,
  };
}

function orgRef(o) {
  if (!o) return null;
  if (!o.name) return { _id: o._id || o };
  return { _id: o._id, name: o.name, logo: o.logo || null, verificationStatus: o.verificationStatus, type: o.type };
}

/**
 * Serialise an initiative. `viewer` controls visibility of host-only fields.
 * @param {object} doc  Initiative document (populated host/organization)
 * @param {{isHost?:boolean,isAdmin?:boolean,isParticipant?:boolean}} opts
 */
function initiativeOut(doc, opts = {}) {
  const obj = typeof doc.toJSON === 'function' ? doc.toJSON() : { ...doc };
  obj.host = publicUserRef(doc.host);
  obj.organization = orgRef(doc.organization);
  // Announcements are visible to host, admin, and registered participants only
  if (!(opts.isHost || opts.isAdmin || opts.isParticipant)) {
    obj.announcementCount = (obj.announcements || []).length;
    delete obj.announcements;
  }
  delete obj.cancelledBy;
  return obj;
}

/** Compact card representation for lists. */
function initiativeCard(doc) {
  const o = typeof doc.toJSON === 'function' ? doc.toJSON() : doc;
  return {
    _id: o._id,
    title: o.title,
    category: o.category,
    coverImage: o.coverImage || null,
    startAt: o.startAt,
    endAt: o.endAt,
    registrationDeadline: o.registrationDeadline,
    location: o.location,
    coordinates: o.coordinates,
    capacity: o.capacity,
    slotsTaken: o.slotsTaken,
    slotsAvailable: o.slotsAvailable,
    payment: { isPaid: Boolean(o.payment?.isPaid), fee: o.payment?.isPaid ? o.payment.fee : 0 },
    requiresApproval: o.requiresApproval,
    status: o.status,
    displayStatus: o.displayStatus,
    host: publicUserRef(doc.host),
    organization: orgRef(doc.organization),
    publishedAt: o.publishedAt,
    createdAt: o.createdAt,
  };
}

module.exports = { publicUserRef, orgRef, initiativeOut, initiativeCard };
