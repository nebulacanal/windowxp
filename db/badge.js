function getPreferenceLabel(preference) {
  return preference === 'top' ? '탑부치' : '바텀팸';
}

function getCurriculumLabel(curriculumGay, curriculumLesbian) {
  if (curriculumGay && curriculumLesbian) return '게이 레즈비언';
  if (curriculumGay) return '게이';
  if (curriculumLesbian) return '레즈비언';
  return '';
}

// 예: "게이 하는 탑부치", "게이 레즈비언 하는 바텀팸"
function getBadgeLabel(preference, curriculumGay, curriculumLesbian) {
  const curriculumLabel = getCurriculumLabel(curriculumGay, curriculumLesbian);
  const preferenceLabel = getPreferenceLabel(preference);
  return curriculumLabel ? `${curriculumLabel} 하는 ${preferenceLabel}` : preferenceLabel;
}

module.exports = { getPreferenceLabel, getCurriculumLabel, getBadgeLabel };
